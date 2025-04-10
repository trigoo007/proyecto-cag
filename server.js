/**
 * Servidor principal para CAG (Contextual Augmentation Generation)
 * 
 * Este servidor maneja las solicitudes API para conversar con Gemma 3 27B
 * utilizando técnicas de augmentación contextual para mejorar las respuestas.
 */

// Dependencias principales
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });
const fetch = require('node-fetch');

// Inicializar Express
const app = express();
const PORT = process.env.PORT || 3000;
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';

// Módulos CAG (importaciones)
const db = require('./src/services/dbService');
const contextAnalyzer = require('./src/services/contextAnalyzer');
const entityExtractor = require('./src/services/entityExtractor');
const contextManager = require('./src/services/contextManager');
const promptBuilder = require('./src/services/promptBuilder');
const memoryStore = require('./src/services/memoryStore');
const documentProcessor = require('./src/services/documentProcessor');
const titleGenerator = require('./src/services/titleGenerator');
const globalMemory = require('./src/services/globalMemory');
const logger = require('./src/utils/logger');
const config = require('./src/config');

// Middleware de seguridad y básicos
app.use(helmet());
app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Límites de peticiones para prevenir abusos
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 100, // Límite de 100 peticiones por ventana
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        error: 'Demasiadas peticiones, intente más tarde',
        code: 'RATE_LIMIT_EXCEEDED'
    }
});
app.use('/api/', apiLimiter);

// Middleware para logging de peticiones
app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        logger.info({
            method: req.method,
            url: req.originalUrl,
            status: res.statusCode,
            responseTime: Date.now() - start,
            ip: req.ip,
            userAgent: req.get('User-Agent')
        });
    });
    next();
});

// Verificar conexión con Ollama antes de iniciar completamente
async function checkOllamaConnection() {
    try {
        logger.info('Verificando conexión con Ollama...');
        const response = await fetch(`${OLLAMA_URL}/api/tags`, {
            method: 'GET',
            timeout: 5000
        });
        
        if (response.ok) {
            logger.info('Conexión con Ollama establecida correctamente');
            
            // Verificar si el modelo Gemma está disponible
            const data = await response.json();
            const gemmaAvailable = data.models.some(model => 
                model.name.includes('gemma3')
            );
            
            if (gemmaAvailable) {
                logger.info('Modelo Gemma3 encontrado y disponible');
            } else {
                logger.warn('ADVERTENCIA: Modelo Gemma3 no encontrado. Asegúrate de descargarlo con: ollama pull gemma3:27b');
            }
            
            return {
                connected: true,
                models: data.models.map(m => m.name),
                defaultModelAvailable: gemmaAvailable
            };
        } else {
            logger.error(`No se pudo conectar con Ollama: ${response.statusText}`);
            return {
                connected: false,
                error: `Estado: ${response.status} ${response.statusText}`
            };
        }
    } catch (error) {
        logger.error('Error al conectar con Ollama:', error);
        logger.info('Asegúrate de que Ollama esté ejecutándose en ' + OLLAMA_URL);
        return {
            connected: false,
            error: error.message
        };
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
        path.join(__dirname, 'data', 'global_memory'),
        path.join(__dirname, 'logs')
    ];

    dirs.forEach(dir => {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
            logger.info(`Directorio creado: ${dir}`);
        }
    });
}

// Rutas para la API

// Obtener configuración
app.get('/api/config', (req, res) => {
    try {
        res.json(config.get());
    } catch (error) {
        res.status(500).json({ 
            error: error.message,
            code: 'CONFIG_ERROR'
        });
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
        res.status(500).json({ 
            error: error.message,
            code: 'CONFIG_UPDATE_ERROR'
        });
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
        logger.error('Error al obtener conversaciones:', error);
        res.status(500).json({ 
            error: error.message,
            code: 'CONVERSATIONS_FETCH_ERROR'
        });
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
        logger.info(`Nueva conversación creada: ${id}`);
        res.json(conversation);
    } catch (error) {
        logger.error('Error al crear conversación:', error);
        res.status(500).json({ 
            error: error.message,
            code: 'CONVERSATION_CREATE_ERROR'
        });
    }
});

// Obtener una conversación específica
app.get('/api/conversations/:id', (req, res) => {
    try {
        const conversation = db.getConversation(req.params.id);
        if (!conversation) {
            return res.status(404).json({ 
                error: 'Conversación no encontrada',
                code: 'CONVERSATION_NOT_FOUND'
            });
        }
        res.json(conversation);
    } catch (error) {
        logger.error(`Error al obtener conversación ${req.params.id}:`, error);
        res.status(500).json({ 
            error: error.message,
            code: 'CONVERSATION_FETCH_ERROR'
        });
    }
});

// Eliminar una conversación
app.delete('/api/conversations/:id', (req, res) => {
    try {
        const { id } = req.params;
        const success = db.deleteConversation(id);
        
        if (!success) {
            return res.status(404).json({ 
                error: 'Conversación no encontrada',
                code: 'CONVERSATION_NOT_FOUND'
            });
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
        
        logger.info(`Conversación eliminada: ${id}`);
        res.json({ success: true });
    } catch (error) {
        logger.error(`Error al eliminar conversación ${req.params.id}:`, error);
        res.status(500).json({ 
            error: error.message,
            code: 'CONVERSATION_DELETE_ERROR'
        });
    }
});

// Añadir mensaje a la conversación
app.post('/api/conversations/:id/messages', async (req, res) => {
    try {
        const { id } = req.params;
        const { role, content } = req.body;
        
        if (!role || !content) {
            return res.status(400).json({
                error: 'Se requieren los campos role y content',
                code: 'INVALID_MESSAGE_FORMAT'
            });
        }
        
        const timestamp = new Date().toISOString();
        
        const conversation = db.getConversation(id);
        if (!conversation) {
            return res.status(404).json({ 
                error: 'Conversación no encontrada',
                code: 'CONVERSATION_NOT_FOUND'
            });
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
        logger.info(`Mensaje añadido a conversación ${id}`);
        
        // Responder con título actualizado si cambió
        res.json({
            message,
            title: conversation.title
        });
    } catch (error) {
        logger.error(`Error al añadir mensaje a conversación ${req.params.id}:`, error);
        res.status(500).json({ 
            error: error.message,
            code: 'MESSAGE_ADD_ERROR'
        });
    }
});

// Generar respuesta con Gemma 3 usando CAG
app.post('/api/generate', async (req, res) => {
    try {
        const { conversation_id, config: userConfig } = req.body;
        
        if (!conversation_id) {
            return res.status(400).json({
                error: 'Se requiere el campo conversation_id',
                code: 'INVALID_REQUEST'
            });
        }
        
        const conversation = db.getConversation(conversation_id);
        if (!conversation) {
            return res.status(404).json({ 
                error: 'Conversación no encontrada',
                code: 'CONVERSATION_NOT_FOUND'
            });
        }
        
        // Obtener el último mensaje del usuario
        const lastMessage = conversation.messages[conversation.messages.length - 1];
        
        if (!lastMessage || lastMessage.role !== 'user') {
            return res.status(400).json({ 
                error: 'No hay un mensaje de usuario para responder',
                code: 'NO_USER_MESSAGE'
            });
        }
        
        logger.info(`Generando respuesta para conversación ${conversation_id}`);
        logger.debug(`Mensaje del usuario: "${lastMessage.content.substring(0, 50)}${lastMessage.content.length > 50 ? '...' : ''}"`);
        
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
            
            logger.debug("Contexto analizado correctamente");
        } catch (contextError) {
            logger.error("Error al analizar contexto:", contextError);
            contextMap = { 
                currentMessage: lastMessage.content,
                currentConversationId: conversation_id
            }; // Contexto mínimo
        }
        
        // Obtener documentos de la conversación
        let documents = [];
        try {
            documents = await documentProcessor.getConversationDocuments(conversation_id);
            logger.debug(`Encontrados ${documents.length} documentos para la conversación`);
            
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
            logger.error("Error al procesar documentos:", docError);
        }
        
        // Enriquecer el contexto con memoria global
        try {
            contextMap = globalMemory.enrichContextWithGlobalMemory(contextMap);
            logger.debug("Contexto enriquecido con memoria global");
        } catch (globalMemoryError) {
            logger.error("Error al enriquecer con memoria global:", globalMemoryError);
        }
        
        // Construir prompt mejorado con CAG
        const cagMessages = promptBuilder.buildCAGPrompt(contextMap, userConfig);
        
        logger.info('Usando CAG para generar respuesta con contexto mejorado');
        
        // Llamar a la API de Ollama con el prompt mejorado
        const ollama_response = await fetch(`${OLLAMA_URL}/api/chat`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: userConfig?.model || 'gemma3:27b',
                messages: cagMessages,
                stream: false,
                options: {
                    temperature: parseFloat(userConfig?.temperature || 0.7),
                    num_predict: parseInt(userConfig?.max_tokens || 2048)
                }
            }),
            timeout: 30000
        });
        
        if (!ollama_response.ok) {
            throw new Error(`Error en la API de Ollama: ${ollama_response.status} ${ollama_response.statusText}`);
        }
        
        const data = await ollama_response.json();
        
        // Procesar la respuesta para mejorar formato
        const processedResponse = formatModelResponse(data.message.content);
        
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
        
        // Variable para controlar si el título cambió
        let titleChanged = false;
        let newTitle = conversation.title;
        
        // Actualizar el título si es necesario basado en la conversación completa
        if (titleGenerator.needsTitleUpdate(conversation)) {
            newTitle = titleGenerator.improveTitle(conversation);
            if (newTitle !== conversation.title) {
                titleChanged = true;
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
            logger.debug('Memoria actualizada correctamente');
        } catch (memoryError) {
            logger.error('Error al actualizar la memoria:', memoryError);
            // Continuar con la respuesta aunque falle la actualización de memoria
        }
        
        // Actualizar memoria global
        try {
            await globalMemory.updateGlobalMemory(
                contextMap,
                lastMessage.content,
                botMessage.content,
                conversation_id
            );
            logger.debug('Memoria global actualizada correctamente');
        } catch (globalMemoryError) {
            logger.error('Error al actualizar memoria global:', globalMemoryError);
        }
        
        res.json({
            ...botMessage,
            title: conversation.title, // Incluir título actualizado
            titleChanged
        });
    } catch (error) {
        logger.error('Error al generar respuesta:', error);
        res.status(500).json({ 
            error: error.message,
            code: 'GENERATION_ERROR'
        });
    }
});

/**
 * Mejora el formato de las respuestas del modelo para presentación
 * @param {string} response - Respuesta original del modelo
 * @returns {string} Respuesta con formato mejorado
 */
function formatModelResponse(response) {
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
            return res.status(400).json({ 
                error: 'No se ha proporcionado ningún archivo',
                code: 'NO_FILE_UPLOADED'
            });
        }
        
        const { id: conversationId } = req.params;
        const fileBuffer = req.file.buffer;
        const fileName = req.file.originalname;
        
        // Verificar que la conversación existe
        const conversation = db.getConversation(conversationId);
        if (!conversation) {
            return res.status(404).json({ 
                error: 'Conversación no encontrada',
                code: 'CONVERSATION_NOT_FOUND'
            });
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
        
        logger.info(`Documento subido para conversación ${conversationId}: ${fileName}`);
        res.json({ 
            success: true,
            documentId: docInfo.id,
            message: 'Documento procesado con éxito',
            documentInfo: docInfo
        });
    } catch (error) {
        logger.error('Error al subir documento:', error);
        
        // Respuesta de error más informativa
        let errorMessage = error.message;
        let statusCode = 500;
        let errorCode = 'DOCUMENT_UPLOAD_ERROR';
        
        if (error.message.includes('tamaño máximo')) {
            statusCode = 413; // Payload Too Large
            errorMessage = 'El archivo excede el tamaño máximo permitido';
            errorCode = 'FILE_TOO_LARGE';
        } else if (error.message.includes('formato')) {
            statusCode = 415; // Unsupported Media Type
            errorMessage = 'Formato de archivo no soportado';
            errorCode = 'UNSUPPORTED_FILE_FORMAT';
        }
        
        res.status(statusCode).json({ 
            error: errorMessage,
            code: errorCode
        });
    }
});

// Obtener todos los documentos asociados a una conversación
app.get('/api/conversations/:id/documents', async (req, res) => {
    try {
        const { id: conversationId } = req.params;
        
        // Verificar que la conversación existe
        const conversation = db.getConversation(conversationId);
        if (!conversation) {
            return res.status(404).json({ 
                error: 'Conversación no encontrada',
                code: 'CONVERSATION_NOT_FOUND'
            });
        }
        
        // Obtener documentos
        const documents = await documentProcessor.getConversationDocuments(conversationId);
        
        res.json(documents);
    } catch (error) {
        logger.error('Error al obtener documentos:', error);
        res.status(500).json({ 
            error: error.message,
            code: 'DOCUMENTS_FETCH_ERROR'
        });
    }
});

// Obtener un documento específico
app.get('/api/conversations/:id/documents/:docId', async (req, res) => {
    try {
        const { id: conversationId, docId } = req.params;
        
        // Obtener documento
        const documentData = await documentProcessor.getDocumentContent(conversationId, docId);
        
        if (!documentData) {
            return res.status(404).json({
                error: 'Documento no encontrado',
                code: 'DOCUMENT_NOT_FOUND'
            });
        }
        
        res.json(documentData);
    } catch (error) {
        logger.error('Error al obtener documento:', error);
        res.status(500).json({ 
            error: error.message,
            code: 'DOCUMENT_FETCH_ERROR'
        });
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
        
        logger.info(`Documento eliminado: ${docId} de conversación ${conversationId}`);
        res.json({ success: true });
    } catch (error) {
        logger.error('Error al eliminar documento:', error);
        res.status(500).json({ 
            error: error.message,
            code: 'DOCUMENT_DELETE_ERROR'
        });
    }
});

// Buscar en documentos
app.get('/api/conversations/:id/documents/search/:term', async (req, res) => {
    try {
        const { id: conversationId, term } = req.params;
        
        if (!term || term.length < 3) {
            return res.status(400).json({ 
                error: 'El término de búsqueda debe tener al menos 3 caracteres',
                code: 'INVALID_SEARCH_TERM'
            });
        }
        
        const results = await documentProcessor.searchDocuments(conversationId, term);
        
        res.json(results);
    } catch (error) {
        logger.error('Error al buscar en documentos:', error);
        res.status(500).json({ 
            error: error.message,
            code: 'DOCUMENT_SEARCH_ERROR'
        });
    }
});

// Editar título de conversación
app.post('/api/conversations/:id/title', (req, res) => {
    try {
        const { id } = req.params;
        const { title } = req.body;
        
        if (!title || title.trim() === '') {
            return res.status(400).json({ 
                error: 'El título no puede estar vacío',
                code: 'INVALID_TITLE'
            });
        }
        
        const conversation = db.getConversation(id);
        if (!conversation) {
            return res.status(404).json({ 
                error: 'Conversación no encontrada',
                code: 'CONVERSATION_NOT_FOUND'
            });
        }
        
        const oldTitle = conversation.title;
        conversation.title = title;
        conversation.titleEdited = true; // Marcar como editado manualmente
        conversation.lastActive = new Date().toISOString();
        
        db.saveConversation(conversation);
        logger.info(`Título de conversación ${id} actualizado: "${title}"`);
        
        res.json({ 
            success: true, 
            title,
            oldTitle
        });
    } catch (error) {
        logger.error('Error al actualizar título:', error);
        res.status(500).json({ 
            error: error.message,
            code: 'TITLE_UPDATE_ERROR'
        });
    }
});

// Obtener información contextual para una conversación
app.get('/api/conversations/:id/context', async (req, res) => {
    try {
        const contextMap = contextManager.getContextMap(req.params.id);
        
        if (!contextMap) {
            return res.status(404).json({ 
                error: 'Información contextual no encontrada',
                code: 'CONTEXT_NOT_FOUND'
            });
        }
        
        res.json(contextMap);
    } catch (error) {
        logger.error('Error al obtener contexto:', error);
        res.status(500).json({ 
            error: error.message,
            code: 'CONTEXT_FETCH_ERROR'
        });
    }
});

// Obtener información de memoria para una conversación
app.get('/api/conversations/:id/memory', async (req, res) => {
    try {
        const memory = await memoryStore.getMemory(req.params.id, null);
        
        if (!memory) {
            return res.status(404).json({ 
                error: 'Información de memoria no encontrada',
                code: 'MEMORY_NOT_FOUND'
            });
        }
        
        res.json(memory);
    } catch (error) {
        logger.error('Error al obtener memoria:', error);
        res.status(500).json({ 
            error: error.message,
            code: 'MEMORY_FETCH_ERROR'
        });
    }
});

// Obtener memoria global
app.get('/api/memory/global', (req, res) => {
    try {
        const globalMemoryContext = globalMemory.getGlobalMemoryContext();
        res.json(globalMemoryContext);
    } catch (error) {
        logger.error('Error al obtener memoria global:', error);
        res.status(500).json({ 
            error: error.message,
            code: 'GLOBAL_MEMORY_FETCH_ERROR'
        });
    }
});

// Ruta para reiniciar la memoria
app.post('/api/memory/reset', async (req, res) => {
    try {
        // Usar la nueva función de reseteo de memoria global
        const globalReset = await globalMemory.resetGlobalMemory();
        
        // Reiniciar memoria del almacenamiento
        const memoryReset = await memoryStore.resetMemory();
        
        logger.info('Memoria global y almacenamiento de memoria reiniciados');
        res.json({ 
            success: true, 
            message: 'Memoria reiniciada correctamente',
            globalReset,
            memoryReset
        });
    } catch (error) {
        logger.error('Error al reiniciar la memoria:', error);
        res.status(500).json({ 
            error: error.message,
            code: 'MEMORY_RESET_ERROR'
        });
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
        
        fetch(`${OLLAMA_URL}/api/tags`, { 
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
        logger.error('Error al verificar dependencias:', error);
        res.status(500).json({ 
            error: error.message,
            code: 'DEPENDENCIES_CHECK_ERROR'
        });
    }
});

// Exportar conversación
app.get('/api/conversations/:id/export', (req, res) => {
    try {
        const conversation = db.getConversation(req.params.id);
        if (!conversation) {
            return res.status(404).json({ 
                error: 'Conversación no encontrada',
                code: 'CONVERSATION_NOT_FOUND'
            });
        }
        
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename=conversation-${req.params.id}.json`);
        res.json(conversation);
    } catch (error) {
        logger.error('Error al exportar conversación:', error);
        res.status(500).json({ 
            error: error.message,
            code: 'CONVERSATION_EXPORT_ERROR'
        });
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
        logger.error('Error al obtener estado del sistema:', error);
        res.status(500).json({ 
            error: error.message,
            code: 'SYSTEM_STATUS_ERROR'
        });
    }
});

// Manejo de errores global
app.use((err, req, res, next) => {
    logger.error('Error inesperado:', err);
    const statusCode = err.statusCode || 500;
    const errorResponse = {
        error: err.message || 'Error interno del servidor',
        code: err.code || 'INTERNAL_SERVER_ERROR',
        timestamp: new Date().toISOString()
    };
    
    // En desarrollo, incluir stack
    if (process.env.NODE_ENV !== 'production') {
        errorResponse.stack = err.stack;
    }
    
    res.status(statusCode).json(errorResponse);
});

// Manejar rutas de frontend (SPA)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Iniciar el servidor
async function startServer() {
    try {
        // Verificar dependencias y conexiones
        ensureDirectories();
        db.init();
        config.init();
        
        // Verificar conexión con Ollama
        await checkOllamaConnection();
        
        // Iniciar escucha en puerto
        app.listen(PORT, () => {
            logger.info(`Servidor CAG funcionando en http://localhost:${PORT}`);
            logger.info(`Sistema iniciado correctamente.`);
            
            // Mostrar dependencias para procesamiento de documentos
            const docDeps = documentProcessor.checkDependencies();
            logger.info('Estado de dependencias para procesamiento de documentos:');
            logger.info('- PDF: ' + (docDeps.pdfExtraction ? 'Disponible' : 'No disponible'));
            logger.info('- DOCX: ' + (docDeps.docxExtraction ? 'Disponible' : 'No disponible'));
            logger.info('- CSV: ' + (docDeps.csvParsing ? 'Disponible' : 'No disponible'));
            logger.info('- Excel: ' + (docDeps.excelExtraction ? 'Disponible' : 'No disponible'));
            
            if (!docDeps.pdfExtraction || !docDeps.docxExtraction || !docDeps.csvParsing || !docDeps.excelExtraction) {
                logger.warn('\nPara habilitar todas las funcionalidades de procesamiento de documentos, ejecute:');
                logger.warn('npm run install-docs');
            }
            
            logger.info('\nLa aplicación está lista para usar.');
        });
    } catch (error) {
        logger.error('Error al iniciar el servidor:', error);
        process.exit(1);
    }
}

// Manejar señales de terminación
process.on('SIGTERM', () => {
    logger.info('Recibida señal SIGTERM. Cerrando servidor...');
    process.exit(0);
});

process.on('SIGINT', () => {
    logger.info('Recibida señal SIGINT. Cerrando servidor...');
    process.exit(0);
});

// Manejar errores no capturados
process.on('uncaughtException', (error) => {
    logger.error('Error no capturado:', error);
    process.exit(1);
});

// Iniciar el servidor
startServer();
