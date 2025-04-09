/**
 * Servidor principal para CAG (Contextual Augmentation Generation)
 * 
 * Este servidor maneja las solicitudes API para conversar con Gemma 3 27B
 * utilizando técnicas de augmentación contextual para mejorar las respuestas.
 */

const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const db = require('./db');
const config = require('./config');
const fetch = require('node-fetch');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });

// Módulos CAG
const contextAnalyzer = require('./context-analyzer');
const entityExtractor = require('./entity-extractor');
const contextManager = require('./context-manager');
const promptBuilder = require('./prompt-builder');
const memoryStore = require('./memory-store');
const documentProcessor = require('./document-processor');
const titleGenerator = require('./title-generator');
const globalMemory = require('./global-memory');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(bodyParser.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Manejo de errores global
app.use((err, req, res, next) => {
    console.error('Error inesperado:', err);
    res.status(500).json({ 
        error: 'Error interno del servidor', 
        message: err.message 
    });
});

// Verificar conexión con Ollama antes de iniciar completamente
async function checkOllamaConnection() {
    try {
        console.log('Verificando conexión con Ollama...');
        const response = await fetch('http://localhost:11434/api/tags', {
            method: 'GET',
            timeout: 5000
        });
        
        if (response.ok) {
            console.log('Conexión con Ollama establecida correctamente');
            
            // Verificar si el modelo Gemma está disponible
            const data = await response.json();
            const gemmaAvailable = data.models.some(model => 
                model.name.includes('gemma3')
            );
            
            if (gemmaAvailable) {
                console.log('Modelo Gemma3 encontrado y disponible');
            } else {
                console.warn('ADVERTENCIA: Modelo Gemma3 no encontrado. Asegúrate de descargarlo con: ollama pull gemma3:27b');
            }
            
            return true;
        } else {
            console.error('No se pudo conectar con Ollama: ' + response.statusText);
            return false;
        }
    } catch (error) {
        console.error('Error al conectar con Ollama:', error.message);
        console.log('Asegúrate de que Ollama esté ejecutándose en http://localhost:11434');
        return false;
    }
}

// Asegurar que todos los directorios necesarios existan
function ensureDirectories() {
    const dirs = [
        path.join(__dirname, 'data'),
        path.join(__dirname, 'data', 'conversations'),
        path.join(__dirname, 'data', 'documents'),
        path.join(__dirname, 'data', 'memory'),
        path.join(__dirname, 'data', 'memory', 'short_term'),
        path.join(__dirname, 'data', 'memory', 'long_term'),
        path.join(__dirname, 'data', 'entities'),
        path.join(__dirname, 'data', 'domains'),
        path.join(__dirname, 'data', 'users'),
        path.join(__dirname, 'data', 'global_memory')
    ];

    dirs.forEach(dir => {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
            console.log(`Directorio creado: ${dir}`);
        }
    });
}

// Inicializar la base de datos, configuración y directorios
ensureDirectories();
db.init();
config.init();

// Rutas para la API

// Obtener configuración
app.get('/api/config', (req, res) => {
    try {
        res.json(config.get());
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Actualizar configuración
app.post('/api/config', (req, res) => {
    try {
        const updatedConfig = config.update(req.body);
        res.json({ 
            success: true, 
            config: updatedConfig 
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Obtener todas las conversaciones
app.get('/api/conversations', (req, res) => {
    try {
        const conversations = db.getAllConversations();
        
        // Incluir estadísticas básicas
        const stats = {
            total: conversations.length,
            active: conversations.filter(c => 
                new Date(c.lastActive || c.created_at) > new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
            ).length
        };
        
        res.json({ conversations, stats });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Crear nueva conversación
app.post('/api/conversations', (req, res) => {
    try {
        const id = uuidv4();
        const title = req.body.title || 'Nueva conversación';
        const created_at = new Date().toISOString();
        
        const conversation = {
            id,
            title,
            created_at,
            lastActive: created_at,
            messages: [],
            titleGeneratedAt: 0 // Para rastrear cuándo se generó el título
        };
        
        db.saveConversation(conversation);
        res.json(conversation);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Obtener una conversación específica
app.get('/api/conversations/:id', (req, res) => {
    try {
        const conversation = db.getConversation(req.params.id);
        if (!conversation) {
            return res.status(404).json({ error: 'Conversación no encontrada' });
        }
        res.json(conversation);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Eliminar una conversación
app.delete('/api/conversations/:id', (req, res) => {
    try {
        const { id } = req.params;
        const success = db.deleteConversation(id);
        
        if (!success) {
            return res.status(404).json({ error: 'Conversación no encontrada' });
        }
        
        // También eliminar documentos asociados
        const docsDir = path.join(__dirname, 'data', 'documents', id);
        if (fs.existsSync(docsDir)) {
            fs.rmSync(docsDir, { recursive: true, force: true });
        }
        
        // Eliminar memoria a corto plazo
        const stmFile = path.join(__dirname, 'data', 'memory', 'short_term', `${id}.json`);
        if (fs.existsSync(stmFile)) {
            fs.unlinkSync(stmFile);
        }
        
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Añadir mensaje a la conversación
app.post('/api/conversations/:id/messages', async (req, res) => {
    try {
        const { id } = req.params;
        const { role, content } = req.body;
        const timestamp = new Date().toISOString();
        
        const conversation = db.getConversation(id);
        if (!conversation) {
            return res.status(404).json({ error: 'Conversación no encontrada' });
        }
        
        const message = { role, content, timestamp };
        conversation.messages.push(message);
        conversation.lastActive = timestamp;
        
        // Actualizar el título si es necesario
        if (titleGenerator.needsTitleUpdate(conversation) && role === 'user') {
            if (conversation.messages.length >= 1 && conversation.messages.length <= 3) {
                // Para conversaciones nuevas
                conversation.title = titleGenerator.generateTitle(conversation.messages);
                conversation.titleGeneratedAt = conversation.messages.length;
            } else if (conversation.messages.length > 5) {
                // Para conversaciones más largas, mejorar el título
                conversation.title = titleGenerator.improveTitle(conversation);
                conversation.titleGeneratedAt = conversation.messages.length;
            }
        }
        
        db.saveConversation(conversation);
        
        // Responder con título actualizado si cambió
        res.json({
            message,
            title: conversation.title
        });
    } catch (error) {
        console.error('Error al añadir mensaje:', error);
        res.status(500).json({ error: error.message });
    }
});

// Generar respuesta con Gemma 3 usando CAG
app.post('/api/generate', async (req, res) => {
    try {
        const { conversation_id, config: userConfig } = req.body;
        
        const conversation = db.getConversation(conversation_id);
        if (!conversation) {
            return res.status(404).json({ error: 'Conversación no encontrada' });
        }
        
        // Obtener el último mensaje del usuario
        const lastMessage = conversation.messages[conversation.messages.length - 1];
        
        if (!lastMessage || lastMessage.role !== 'user') {
            return res.status(400).json({ error: 'No hay un mensaje de usuario para responder' });
        }
        
        console.log(`Generando respuesta para conversación ${conversation_id}`);
        console.log(`Mensaje del usuario: "${lastMessage.content.substring(0, 50)}${lastMessage.content.length > 50 ? '...' : ''}"`);
        
        // Analizar el contexto usando CAG
        let contextMap;
        try {
            contextMap = await contextAnalyzer.analyzeMessage(
                conversation_id,
                null, // userId (podría implementarse un sistema de usuarios)
                lastMessage.content
            );
            
            // Añadir ID de conversación al contexto
            contextMap.currentConversationId = conversation_id;
            
            console.log("Contexto analizado correctamente");
        } catch (contextError) {
            console.error("Error al analizar contexto:", contextError);
            contextMap = { 
                currentMessage: lastMessage.content,
                currentConversationId: conversation_id
            }; // Contexto mínimo
        }
        
        // Obtener documentos de la conversación
        let documents = [];
        try {
            documents = await documentProcessor.getConversationDocuments(conversation_id);
            console.log(`Encontrados ${documents.length} documentos para la conversación`);
            
            // Enriquecer el contextMap con información de documentos
            if (documents && documents.length > 0) {
                contextMap.documents = documents.map(doc => ({
                    id: doc.id,
                    name: doc.originalName,
                    summary: doc.summary,
                    keyConcepts: doc.keyConcepts,
                    entities: doc.entities,
                    format: doc.format || 'Desconocido',
                    uploadDate: doc.uploadDate
                }));
            }
        } catch (docError) {
            console.error("Error al procesar documentos:", docError);
        }
        
        // Enriquecer el contexto con memoria global
        try {
            contextMap = globalMemory.enrichContextWithGlobalMemory(contextMap);
            console.log("Contexto enriquecido con memoria global");
        } catch (globalMemoryError) {
            console.error("Error al enriquecer con memoria global:", globalMemoryError);
        }
        
        // Construir prompt mejorado con CAG
        const cagMessages = promptBuilder.buildCAGPrompt(contextMap, userConfig);
        
        console.log('Usando CAG para generar respuesta con contexto mejorado');
        
        // Llamar a la API de Ollama con el prompt mejorado
        const ollama_response = await fetch('http://localhost:11434/api/chat', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'gemma3:27b',
                messages: cagMessages,
                stream: false,
                options: {
                    temperature: parseFloat(userConfig.temperature || 0.7),
                    num_predict: parseInt(userConfig.max_tokens || 2048)
                }
            })
        });
        
        if (!ollama_response.ok) {
            throw new Error(`Error en la API de Ollama: ${ollama_response.status} ${ollama_response.statusText}`);
        }
        
        const data = await ollama_response.json();
        
        // Procesar la respuesta para mejorar formato
        const processedResponse = this._formatModelResponse(data.message.content);
        
        // Guardar la respuesta en la conversación
        const timestamp = new Date().toISOString();
        const botMessage = {
            role: 'bot',
            content: processedResponse,
            timestamp
        };
        
        conversation.messages.push(botMessage);
        conversation.lastActive = timestamp;
        db.saveConversation(conversation);
        
        // Actualizar el título si es necesario basado en la conversación completa
        if (titleGenerator.needsTitleUpdate(conversation)) {
            const newTitle = titleGenerator.improveTitle(conversation);
            if (newTitle !== conversation.title) {
                conversation.title = newTitle;
                conversation.titleGeneratedAt = conversation.messages.length;
                db.saveConversation(conversation);
            }
        }
        
        // Actualizar el contexto y la memoria con la respuesta
        try {
            await contextAnalyzer.updateAfterResponse(
                conversation_id, 
                null, // userId
                contextMap,
                lastMessage.content,
                botMessage.content
            );
            console.log('Memoria actualizada correctamente');
        } catch (memoryError) {
            console.error('Error al actualizar la memoria:', memoryError);
            // Continuar con la respuesta aunque falle la actualización de memoria
        }
        
        // Actualizar memoria global
        try {
            await globalMemory.updateGlobalMemory(
                contextMap,
                lastMessage.content,
                botMessage.content,
                conversation_id // Añadir ID de conversación
            );
            console.log('Memoria global actualizada correctamente');
        } catch (globalMemoryError) {
            console.error('Error al actualizar memoria global:', globalMemoryError);
        }
        
        res.json({
            ...botMessage,
            title: conversation.title, // Incluir título actualizado
            titleChanged: newTitle !== conversation.title
        });
    } catch (error) {
        console.error('Error al generar respuesta:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * Mejora el formato de las respuestas del modelo para presentación
 * @param {string} response - Respuesta original del modelo
 * @returns {string} Respuesta con formato mejorado
 */
function _formatModelResponse(response) {
    if (!response) return '';
    
    let formattedResponse = response;
    
    // Asegurar que las listas tengan formato adecuado
    formattedResponse = formattedResponse
        // Asegurar que los asteriscos para listas tengan espacio después
        .replace(/^(\*+)([^\s*])/gm, '$1 $2')
        // Asegurar que listas numeradas tengan espacio después del punto
        .replace(/^(\d+\.)([^\s])/gm, '$1 $2');

    // Asegurar espaciado adecuado para encabezados markdown
    formattedResponse = formattedResponse
        .replace(/^(#{1,6})([^#\s])/gm, '$1 $2');
    
    // Normalizar múltiples líneas en blanco a máximo dos
    formattedResponse = formattedResponse
        .replace(/\n{3,}/g, '\n\n');
    
    return formattedResponse;
}

// Rutas para documentos

// Subir un documento a una conversación
app.post('/api/conversations/:id/documents', upload.single('document'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No se ha proporcionado ningún archivo' });
        }
        
        const { id: conversationId } = req.params;
        const fileBuffer = req.file.buffer;
        const fileName = req.file.originalname;
        
        // Verificar que la conversación existe
        const conversation = db.getConversation(conversationId);
        if (!conversation) {
            return res.status(404).json({ error: 'Conversación no encontrada' });
        }
        
        // Procesar el documento
        const docInfo = await documentProcessor.processDocument(
            fileBuffer,
            fileName,
            conversationId
        );
        
        // Añadir mensaje al sistema sobre el documento subido
        const timestamp = new Date().toISOString();
        const systemMessage = {
            role: 'system',
            content: `Documento subido: "${fileName}". Este documento contiene información sobre: ${docInfo.keyConcepts.map(c => c.word).join(', ')}.`,
            timestamp
        };
        
        conversation.messages.push(systemMessage);
        conversation.lastActive = timestamp;
        db.saveConversation(conversation);
        
        res.json({ 
            success: true,
            documentId: docInfo.id,
            message: 'Documento procesado con éxito',
            documentInfo: docInfo
        });
    } catch (error) {
        console.error('Error al subir documento:', error);
        
        // Respuesta de error más informativa
        let errorMessage = error.message;
        let statusCode = 500;
        
        if (error.message.includes('tamaño máximo')) {
            statusCode = 413; // Payload Too Large
            errorMessage = 'El archivo excede el tamaño máximo permitido';
        } else if (error.message.includes('formato')) {
            statusCode = 415; // Unsupported Media Type
            errorMessage = 'Formato de archivo no soportado';
        }
        
        res.status(statusCode).json({ error: errorMessage });
    }
});

// Obtener todos los documentos asociados a una conversación
app.get('/api/conversations/:id/documents', async (req, res) => {
    try {
        const { id: conversationId } = req.params;
        
        // Verificar que la conversación existe
        const conversation = db.getConversation(conversationId);
        if (!conversation) {
            return res.status(404).json({ error: 'Conversación no encontrada' });
        }
        
        // Obtener documentos
        const documents = await documentProcessor.getConversationDocuments(conversationId);
        
        res.json(documents);
    } catch (error) {
        console.error('Error al obtener documentos:', error);
        res.status(500).json({ error: error.message });
    }
});

// Obtener un documento específico
app.get('/api/conversations/:id/documents/:docId', async (req, res) => {
    try {
        const { id: conversationId, docId } = req.params;
        
        // Obtener documento
        const documentData = await documentProcessor.getDocumentContent(conversationId, docId);
        
        res.json(documentData);
    } catch (error) {
        console.error('Error al obtener documento:', error);
        res.status(500).json({ error: error.message });
    }
});

// Eliminar un documento
app.delete('/api/conversations/:id/documents/:docId', async (req, res) => {
    try {
        const { id: conversationId, docId } = req.params;
        
        await documentProcessor.deleteDocument(conversationId, docId);
        
        // Registrar la eliminación en la conversación
        const conversation = db.getConversation(conversationId);
        if (conversation) {
            const timestamp = new Date().toISOString();
            conversation.messages.push({
                role: 'system',
                content: `Documento eliminado (ID: ${docId}).`,
                timestamp
            });
            conversation.lastActive = timestamp;
            db.saveConversation(conversation);
        }
        
        res.json({ success: true });
    } catch (error) {
        console.error('Error al eliminar documento:', error);
        res.status(500).json({ error: error.message });
    }
});

// Buscar en documentos
app.get('/api/conversations/:id/documents/search/:term', async (req, res) => {
    try {
        const { id: conversationId, term } = req.params;
        
        if (!term || term.length < 3) {
            return res.status(400).json({ 
                error: 'El término de búsqueda debe tener al menos 3 caracteres' 
            });
        }
        
        const results = await documentProcessor.searchDocuments(conversationId, term);
        
        res.json(results);
    } catch (error) {
        console.error('Error al buscar en documentos:', error);
        res.status(500).json({ error: error.message });
    }
});

// Editar título de conversación
app.post('/api/conversations/:id/title', (req, res) => {
    try {
        const { id } = req.params;
        const { title } = req.body;
        
        if (!title || title.trim() === '') {
            return res.status(400).json({ error: 'El título no puede estar vacío' });
        }
        
        const conversation = db.getConversation(id);
        if (!conversation) {
            return res.status(404).json({ error: 'Conversación no encontrada' });
        }
        
        const oldTitle = conversation.title;
        conversation.title = title;
        conversation.titleEdited = true; // Marcar como editado manualmente
        conversation.lastActive = new Date().toISOString();
        
        db.saveConversation(conversation);
        
        res.json({ 
            success: true, 
            title,
            oldTitle
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Obtener información contextual para una conversación
app.get('/api/conversations/:id/context', async (req, res) => {
    try {
        const contextMap = contextManager.getContextMap(req.params.id);
        
        if (!contextMap) {
            return res.status(404).json({ error: 'Información contextual no encontrada' });
        }
        
        res.json(contextMap);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Obtener información de memoria para una conversación
app.get('/api/conversations/:id/memory', async (req, res) => {
    try {
        const memory = await memoryStore.getMemory(req.params.id, null);
        
        if (!memory) {
            return res.status(404).json({ error: 'Información de memoria no encontrada' });
        }
        
        res.json(memory);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Obtener memoria global
app.get('/api/memory/global', (req, res) => {
    try {
        const globalMemoryContext = globalMemory.getGlobalMemoryContext();
        res.json(globalMemoryContext);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Ruta para reiniciar la memoria
app.post('/api/memory/reset', async (req, res) => {
    try {
        // Usar la nueva función de reseteo de memoria global
        const globalReset = await globalMemory.resetGlobalMemory();
        
        // Reiniciar memoria del almacenamiento
        const memoryReset = await memoryStore.resetMemory();
        
        res.json({ 
            success: true, 
            message: 'Memoria reiniciada correctamente',
            globalReset,
            memoryReset
        });
    } catch (error) {
        console.error('Error al reiniciar la memoria:', error);
        res.status(500).json({ error: error.message });
    }
});

// Ruta para comprobar dependencias del sistema
app.get('/api/system/dependencies', (req, res) => {
    try {
        // Verificar dependencias para procesamiento de documentos
        const docDependencies = documentProcessor.checkDependencies();
        
        // Verificar conexión con Ollama
        const ollamaStatus = {
            checked: true,
            connected: false,
            error: null
        };
        
        fetch('http://localhost:11434/api/tags', { 
            method: 'GET', 
            timeout: 2000 
        })
        .then(response => {
            ollamaStatus.connected = response.ok;
            if (!response.ok) {
                ollamaStatus.error = `Estado: ${response.status} ${response.statusText}`;
            }
            sendResponse();
        })
        .catch(error => {
            ollamaStatus.error = error.message;
            sendResponse();
        });
        
        function sendResponse() {
            res.json({
                documentProcessing: docDependencies,
                ollama: ollamaStatus,
                nodeVersion: process.version,
                platform: process.platform,
                memory: {
                    total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
                    used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024)
                }
            });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Exportar conversación
app.get('/api/conversations/:id/export', (req, res) => {
    try {
        const conversation = db.getConversation(req.params.id);
        if (!conversation) {
            return res.status(404).json({ error: 'Conversación no encontrada' });
        }
        
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename=conversation-${req.params.id}.json`);
        res.json(conversation);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Ruta para estado general del sistema
app.get('/api/system/status', (req, res) => {
    try {
        // Obtener estadísticas de la base de datos
        const conversations = db.getAllConversations();
        const conversationsCount = conversations.length;
        const activeConversations = conversations.filter(c => 
            new Date(c.lastActive || c.created_at) > new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
        ).length;
        
        // Contar total de mensajes
        const totalMessages = conversations.reduce((count, conv) => 
            count + (conv.messages ? conv.messages.length : 0), 0);
        
        // Contar documentos
        let documentCount = 0;
        if (fs.existsSync(path.join(__dirname, 'data', 'documents'))) {
            const docDirs = fs.readdirSync(path.join(__dirname, 'data', 'documents'));
            
            for (const dir of docDirs) {
                const dirPath = path.join(__dirname, 'data', 'documents', dir);
                if (fs.statSync(dirPath).isDirectory()) {
                    const files = fs.readdirSync(dirPath);
                    documentCount += files.filter(f => !f.endsWith('.meta.json') && !f.endsWith('.txt')).length;
                }
            }
        }
        
        // Consultar memoria global
        const globalMemoryContext = globalMemory.getGlobalMemoryContext();
        const entityCount = globalMemoryContext.entities ? globalMemoryContext.entities.length : 0;
        const topicCount = globalMemoryContext.topics ? globalMemoryContext.topics.length : 0;
        
        res.json({
            status: 'operativo',
            timestamp: new Date().toISOString(),
            statistics: {
                conversations: {
                    total: conversationsCount,
                    active: activeConversations
                },
                messages: totalMessages,
                documents: documentCount,
                entities: entityCount,
                topics: topicCount
            },
            system: {
                nodeVersion: process.version,
                platform: process.platform,
                memory: {
                    total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024) + ' MB',
                    used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + ' MB'
                },
                uptime: Math.floor(process.uptime() / 60) + ' minutos'
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Manejar rutas de frontend (SPA)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Iniciar el servidor
async function startServer() {
    // Verificar dependencias y conexiones
    await checkOllamaConnection();
    
    // Iniciar escucha en puerto
    app.listen(PORT, () => {
        console.log(`Servidor CAG funcionando en http://localhost:${PORT}`);
        console.log(`Asegurándose de que todos los directorios necesarios existan...`);
        ensureDirectories();
        console.log(`Sistema iniciado correctamente.`);
        
        // Mostrar dependencias para procesamiento de documentos
        const docDeps = documentProcessor.checkDependencies();
        console.log('Estado de dependencias para procesamiento de documentos:');
        console.log('- PDF: ' + (docDeps.pdfExtraction ? 'Disponible' : 'No disponible'));
        console.log('- DOCX: ' + (docDeps.docxExtraction ? 'Disponible' : 'No disponible'));
        console.log('- CSV: ' + (docDeps.csvParsing ? 'Disponible' : 'No disponible'));
        console.log('- Excel: ' + (docDeps.excelExtraction ? 'Disponible' : 'No disponible'));
        
        if (!docDeps.pdfExtraction || !docDeps.docxExtraction || !docDeps.csvParsing || !docDeps.excelExtraction) {
            console.log('\nPara habilitar todas las funcionalidades de procesamiento de documentos, ejecute:');
            console.log('npm run install-docs');
        }
        
        console.log('\nLa aplicación está lista para usar.');
    });
}

startServer();