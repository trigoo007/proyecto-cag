/**
 * Analizador de Contexto para CAG
 * 
 * Este módulo analiza mensajes para extraer información contextual relevante
 * que mejora la generación de respuestas del modelo.
 * Implementa sistema de caché y optimización de procesamiento.
 * 
 * NOTA: Este archivo debería dividirse en módulos más pequeños:
 * - analyzers/
 *   - entity-analyzer.js (extractEntitiesWithNLP)
 *   - sentiment-analyzer.js (analyzeSentimentImproved)
 *   - intent-analyzer.js (detectIntent)
 *   - language-detector.js (detectLanguageImproved)
 *   - structure-analyzer.js (analyzeMessageStructure, categorizeQuestion)
 *   - topic-extractor.js (extractTopics)
 *   - semantic-analyzer.js (vectorizeText, cosineSimilarity)
 * - storage/
 *   - cache-manager.js (cleanupCache, getCachedAnalysis, saveCachedAnalysis)
 *   - context-store.js (saveContextMap)
 * - utils/
 *   - retry.js (withRetry)
 *   - nlp-loader.js (initNLPModels)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const entityExtractor = require('./entity-extractor');
const memoryStore = require('./memory-store');
const db = require('./db');
const documentProcessor = require('./document-processor');
const LRUCache = require('lru-cache'); // Nuevo: Agregar caché LRU para mejor rendimiento
const nlp = require('compromise-es'); // Nuevo: Librería NLP más potente
const { TfIdfVectorizer } = require('natural'); // Nuevo: Para análisis semántico mejorado

// Directorio para almacenamiento de datos
const DATA_DIR = path.join(__dirname, 'data');
const CONTEXTS_DIR = path.join(DATA_DIR, 'contexts');
const CONTEXTS_CACHE_DIR = path.join(CONTEXTS_DIR, 'cache');

// Configuración
const MAX_CONTEXT_MESSAGES = 10;       // Número máximo de mensajes a considerar para contexto
const SIMILARITY_THRESHOLD = 0.75;     // Umbrales para análisis semántico
const MAX_TOPICS = 5;                  // Máximo número de temas a extraer
const CACHE_EXPIRY = 1000 * 60 * 60;   // Tiempo de expiración de caché (1 hora)
const MAX_CACHE_ENTRIES = 1000;        // Número máximo de entradas en caché
const MAX_RETRIES = 3;                 // Número máximo de reintentos para operaciones críticas
const RETRY_DELAY = 300;               // Retraso base entre reintentos (ms)

// Soporte multilingüe mejorado
const SUPPORTED_LANGUAGES = ['es', 'en', 'fr', 'pt', 'it'];
const nlpModels = {};

// Caché en memoria para análisis frecuentes con LRU
const analysisCache = new LRUCache({
    max: MAX_CACHE_ENTRIES,
    ttl: CACHE_EXPIRY,
    updateAgeOnGet: true
});

// Inicializar vectorizador para análisis semántico
const vectorizer = new TfIdfVectorizer();

// Contador de hits y misses de caché para rendimiento
let cacheStats = { hits: 0, misses: 0, entries: 0 };

/**
 * Inicializa el analizador de contexto
 */
async function init() {
    try {
        // Crear directorios necesarios
        const dirs = [
            CONTEXTS_DIR,
            CONTEXTS_CACHE_DIR
        ];
        
        for (const dir of dirs) {
            if (!fs.existsSync(dir)) {
                await fs.promises.mkdir(dir, { recursive: true });
                console.log(`ContextAnalyzer: Directorio creado - ${dir}`);
            }
        }
        
        // Inicializar modelos NLP para idiomas soportados
        await initNLPModels();
        
        // Programar limpieza de caché
        scheduleCleanup();
        
        console.log('ContextAnalyzer: Inicializado correctamente');
    } catch (error) {
        console.error('ContextAnalyzer: Error de inicialización:', error);
    }
}

/**
 * Inicializa modelos NLP para diferentes idiomas
 * @private
 */
async function initNLPModels() {
    try {
        // Inicializar modelos NLP específicos por idioma
        for (const lang of SUPPORTED_LANGUAGES) {
            try {
                // Aquí se cargarían modelos específicos para cada idioma
                console.log(`ContextAnalyzer: Inicializando modelo NLP para idioma ${lang}`);
                
                // Ejemplo de carga de diferentes modelos según el idioma
                // En una implementación real, se cargarían modelos específicos
                switch(lang) {
                    case 'es':
                        nlpModels[lang] = nlp; // compromise-es para español
                        break;
                    case 'en':
                        // En una implementación real: nlpModels[lang] = require('compromise');
                        nlpModels[lang] = nlp; 
                        break;
                    default:
                        // Modelo genérico para otros idiomas
                        nlpModels[lang] = nlp;
                }
            } catch (langError) {
                console.warn(`ContextAnalyzer: No se pudo cargar modelo NLP para ${lang}:`, langError.message);
            }
        }
    } catch (error) {
        console.error('ContextAnalyzer: Error al inicializar modelos NLP:', error);
    }
}

/**
 * Programa limpieza periódica de caché
 * @private
 */
function scheduleCleanup() {
    // Limpieza cada 30 minutos
    setInterval(() => {
        try {
            cleanupCache();
            console.log(`ContextAnalyzer: Limpieza de caché completada. Estadísticas: ${JSON.stringify(cacheStats)}`);
        } catch (error) {
            console.error('ContextAnalyzer: Error en limpieza de caché:', error);
        }
    }, 30 * 60 * 1000);
}

/**
 * Función auxiliar para reintentar operaciones
 * @param {Function} operation - Operación a ejecutar
 * @param {number} maxRetries - Número máximo de intentos
 * @param {number} delayMs - Retraso base entre intentos
 * @returns {Promise<any>} Resultado de la operación
 * @private
 */
async function withRetry(operation, maxRetries = MAX_RETRIES, delayMs = RETRY_DELAY) {
    let lastError;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            return await operation();
        } catch (error) {
            lastError = error;
            console.warn(`ContextAnalyzer: Reintento ${attempt + 1}/${maxRetries} tras error:`, error.message);
            await new Promise(resolve => setTimeout(resolve, delayMs * Math.pow(2, attempt))); // Backoff exponencial
        }
    }
    throw lastError; // Si llegamos aquí, todos los reintentos fallaron
}

/**
 * Limpia entradas antiguas de la caché con sistema de decaimiento temporal
 * @private
 */
async function cleanupCache() {
    try {
        const now = Date.now();
        let removedCount = 0;
        
        // Aplicar decaimiento temporal basado en relevancia y antigüedad
        const decayThresholds = [
            { age: 1000 * 60 * 60 * 24 * 7, factor: 0.5 },  // Una semana: mantener 50%
            { age: 1000 * 60 * 60 * 24 * 3, factor: 0.7 },  // Tres días: mantener 70%
            { age: 1000 * 60 * 60 * 24, factor: 0.9 }       // Un día: mantener 90%
        ];
        
        // Limpiar archivos de caché en disco con decaimiento temporal
        if (fs.existsSync(CONTEXTS_CACHE_DIR)) {
            const files = await fs.promises.readdir(CONTEXTS_CACHE_DIR);
            
            for (const file of files) {
                const filePath = path.join(CONTEXTS_CACHE_DIR, file);
                const stats = await fs.promises.stat(filePath);
                const fileAge = now - stats.mtimeMs;
                
                // Verificar contra umbrales de decaimiento
                let shouldDelete = false;
                
                // Si es más viejo que la entrada más antigua, eliminar
                if (fileAge > decayThresholds[0].age) {
                    shouldDelete = true;
                } else {
                    // Aplicar factores de probabilidad basados en decaimiento
                    for (const threshold of decayThresholds) {
                        if (fileAge > threshold.age) {
                            // Usar factor como probabilidad de eliminar
                            shouldDelete = Math.random() > threshold.factor;
                            break;
                        }
                    }
                }
                
                if (shouldDelete) {
                    await fs.promises.unlink(filePath);
                    removedCount++;
                }
            }
        }
        
        // Actualizar estadísticas
        cacheStats.entries = analysisCache.size;
        
        return { cleaned: removedCount, remaining: analysisCache.size };
    } catch (error) {
        console.error('ContextAnalyzer: Error al limpiar caché:', error);
        return { cleaned: 0, error: error.message };
    }
}

/**
 * Genera clave de caché para un mensaje
 * @param {string} message - Mensaje a procesar
 * @returns {string} Clave de caché
 * @private
 */
function generateCacheKey(message) {
    // Normalizar mensaje para caché
    const normalizedMessage = message
        .toLowerCase()
        .trim()
        .replace(/\s+/g, ' ');
    
    // Generar hash
    return crypto.createHash('md5').update(normalizedMessage).digest('hex');
}

/**
 * Analiza un mensaje para extraer información contextual
 * @param {string} conversationId - ID de la conversación
 * @param {string} userId - ID del usuario (opcional)
 * @param {string} message - Mensaje a analizar
 * @returns {Promise<Object>} Mapa de contexto generado
 */
async function analyzeMessage(conversationId, userId, message) {
    try {
        // Validar entrada
        if (!message || message.trim() === '') {
            return { currentMessage: '' };
        }
        
        if (!conversationId) {
            console.warn('ContextAnalyzer: No se proporcionó ID de conversación');
            return { currentMessage: message };
        }
        
        // Verificar caché primero para análisis semántico
        const cacheKey = generateCacheKey(message);
        const cachedSemanticAnalysis = await getCachedAnalysis(cacheKey);
        
        // Crear un objeto con el contexto inicial
        const contextMap = {
            currentMessage: message,
            timestamp: new Date().toISOString(),
            conversationId
        };
        
        // Obtener historial de conversación con reintentos
        let conversation = await withRetry(() => db.getConversation(conversationId));
        
        if (!conversation) {
            console.warn(`ContextAnalyzer: Conversación ${conversationId} no encontrada`);
            return contextMap;
        }
        
        // Añadir historial reciente (últimos N mensajes)
        contextMap.recentMessages = conversation.messages
            .slice(-MAX_CONTEXT_MESSAGES)
            .map(msg => ({
                role: msg.role,
                content: msg.content,
                timestamp: msg.timestamp
            }));
        
        // Si tenemos análisis en caché, usarlo directamente
        if (cachedSemanticAnalysis) {
            // Usar los resultados de caché para información semántica
            Object.assign(contextMap, cachedSemanticAnalysis);
            cacheStats.hits++;
            
            // Aún necesitamos analizar relaciones con mensajes anteriores
            await analyzeMessageRelationships(contextMap);
        } else {
            // Extraer información semántica del mensaje actual
            await extractSemanticInfo(message, contextMap);
            cacheStats.misses++;
            
            // Guardar en caché para uso futuro
            const semanticData = {
                entities: contextMap.entities,
                intent: contextMap.intent,
                topics: contextMap.topics, 
                sentiment: contextMap.sentiment,
                language: contextMap.language,
                messageStructure: contextMap.messageStructure,
                questionType: contextMap.questionType
            };
            
            // Guardar en caché
            await saveCachedAnalysis(cacheKey, semanticData);
            
            // Analizar la relación con mensajes anteriores
            await analyzeMessageRelationships(contextMap);
        }
        
        // Cargar memoria si existe
        try {
            const memory = await withRetry(() => memoryStore.getMemory(conversationId, userId));
            if (memory) {
                contextMap.memory = memory;
            }
        } catch (memoryError) {
            console.error('ContextAnalyzer: Error al cargar memoria:', memoryError);
        }
        
        // Integrar información de documentos asociados a la conversación
        try {
            await enrichWithDocumentContext(conversationId, message, contextMap);
        } catch (docError) {
            console.error('ContextAnalyzer: Error al enriquecer con contexto de documentos:', docError);
        }
        
        // Guardar contexto para uso futuro
        await saveContextMap(conversationId, contextMap);
        
        return contextMap;
    } catch (error) {
        console.error('ContextAnalyzer: Error al analizar mensaje:', error);
        // Devolver un contexto mínimo en caso de error
        return { 
            currentMessage: message,
            error: error.message,
            timestamp: new Date().toISOString()
        };
    }
}

/**
 * Vectoriza texto para comparaciones semánticas
 * @param {string} text - Texto a vectorizar
 * @returns {Array} Vector de características
 * @private
 */
function vectorizeText(text) {
    try {
        if (!text || typeof text !== 'string') {
            return null;
        }
        
        // Procesar texto
        const processedText = text.toLowerCase()
            .replace(/[^\wáéíóúüñ\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
            
        // Tokenizar y vectorizar
        const tokens = processedText.split(' ').filter(t => t.length > 2);
        return vectorizer.vectorize(tokens);
    } catch (error) {
        console.error('ContextAnalyzer: Error al vectorizar texto:', error);
        return null;
    }
}

/**
 * Calcula similitud coseno entre dos vectores
 * @param {Array} vec1 - Primer vector
 * @param {Array} vec2 - Segundo vector
 * @returns {number} Similitud coseno (0-1)
 * @private
 */
function cosineSimilarity(vec1, vec2) {
    try {
        if (!vec1 || !vec2 || !vec1.length || !vec2.length) {
            return 0;
        }
        
        // Producto punto
        let dotProduct = 0;
        let normA = 0;
        let normB = 0;
        
        for (let i = 0; i < vec1.length; i++) {
            dotProduct += vec1[i] * (vec2[i] || 0);
            normA += vec1[i] * vec1[i];
        }
        
        for (let i = 0; i < vec2.length; i++) {
            normB += vec2[i] * vec2[i];
        }
        
        if (normA === 0 || normB === 0) {
            return 0;
        }
        
        return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
    } catch (error) {
        console.error('ContextAnalyzer: Error al calcular similitud coseno:', error);
        return 0;
    }
}

/**
 * Obtiene análisis en caché
 * @param {string} cacheKey - Clave de caché
 * @returns {Promise<Object|null>} Análisis en caché o null si no existe
 * @private
 */
async function getCachedAnalysis(cacheKey) {
    try {
        // Primero verificar caché en memoria LRU
        const cachedEntry = analysisCache.get(cacheKey);
        if (cachedEntry) {
            return cachedEntry;
        }
        
        // Después verificar caché en disco
        const cachePath = path.join(CONTEXTS_CACHE_DIR, `${cacheKey}.json`);
        if (fs.existsSync(cachePath)) {
            try {
                const stats = await fs.promises.stat(cachePath);
                
                // Verificar expiración
                if (Date.now() - stats.mtimeMs < CACHE_EXPIRY) {
                    const cacheData = JSON.parse(await fs.promises.readFile(cachePath, 'utf8'));
                    
                    // Actualizar caché en memoria también
                    analysisCache.set(cacheKey, cacheData);
                    
                    return cacheData;
                } else {
                    // Eliminar archivo expirado
                    await fs.promises.unlink(cachePath);
                }
            } catch (err) {
                console.error('ContextAnalyzer: Error al leer caché de disco:', err);
            }
        }
        
        return null;
    } catch (error) {
        console.error('ContextAnalyzer: Error al recuperar caché:', error);
        return null;
    }
}

/**
 * Guarda análisis en caché
 * @param {string} cacheKey - Clave de caché
 * @param {Object} data - Datos a almacenar
 * @private
 */
async function saveCachedAnalysis(cacheKey, data) {
    try {
        // Guardar en caché en memoria LRU
        analysisCache.set(cacheKey, data);
        
        // Actualizar estadísticas
        cacheStats.entries = analysisCache.size;
        
        // Guardar en caché en disco
        try {
            if (!fs.existsSync(CONTEXTS_CACHE_DIR)) {
                await fs.promises.mkdir(CONTEXTS_CACHE_DIR, { recursive: true });
            }
            
            const cachePath = path.join(CONTEXTS_CACHE_DIR, `${cacheKey}.json`);
            await fs.promises.writeFile(cachePath, JSON.stringify(data), 'utf8');
        } catch (diskErr) {
            console.error('ContextAnalyzer: Error al guardar caché en disco:', diskErr);
        }
    } catch (error) {
        console.error('ContextAnalyzer: Error al guardar caché:', error);
    }
}

/**
 * Extrae entidades usando biblioteca NLP avanzada
 * @param {string} message - Mensaje a analizar
 * @param {string} language - Código de idioma detectado
 * @returns {Promise<Array>} Entidades detectadas
 * @private
 */
async function extractEntitiesWithNLP(message, language = 'es') {
    try {
        // Seleccionar el modelo NLP adecuado según el idioma
        const model = nlpModels[language] || nlp;
        
        // Utilizar compromise-es para análisis de entidades
        const doc = model(message);
        
        // Extraer personas
        const people = doc.people().out('array').map(name => ({
            name,
            type: 'person',
            confidence: 0.85
        }));
        
        // Extraer lugares
        const places = doc.places().out('array').map(place => ({
            name: place,
            type: 'place',
            confidence: 0.8
        }));
        
        // Extraer organizaciones
        const orgs = doc.organizations().out('array').map(org => ({
            name: org,
            type: 'organization',
            confidence: 0.75
        }));
        
        // Extraer valores numéricos
        const values = doc.values().out('array').map(value => ({
            name: value,
            type: 'value',
            confidence: 0.9
        }));
        
        // Combinar todas las entidades
        return [...people, ...places, ...orgs, ...values];
    } catch (error) {
        console.error('ContextAnalyzer: Error al extraer entidades con NLP:', error);
        return [];
    }
}

/**
 * Extrae información semántica de un mensaje
 * @param {string} message - Mensaje a analizar
 * @param {Object} contextMap - Mapa de contexto a enriquecer
 * @returns {Promise<void>}
 * @private
 */
async function extractSemanticInfo(message, contextMap) {
    try {
        // Detectar el idioma primero para mejorar el análisis posterior
        const language = detectLanguageImproved(message);
        contextMap.language = language;
        
        // Extraer entidades usando NLP avanzado
        const entitiesNLP = await extractEntitiesWithNLP(message, language.code);
        
        // Obtener entidades del extractor tradicional como respaldo
        const entitiesTraditional = await entityExtractor.extractEntities(message);
        
        // Combinar entidades y eliminar duplicados
        const allEntities = [...entitiesNLP];
        if (entitiesTraditional && entitiesTraditional.length > 0) {
            entitiesTraditional.forEach(entity => {
                if (!allEntities.some(e => e.name.toLowerCase() === entity.name.toLowerCase())) {
                    allEntities.push(entity);
                }
            });
        }
        
        if (allEntities.length > 0) {
            contextMap.entities = allEntities;
        }
        
        // Detectar intención del mensaje
        const intent = detectIntent(message);
        if (intent) {
            contextMap.intent = intent;
        }
        
        // Extraer temas del mensaje
        const topics = extractTopics(message);
        if (topics && topics.length > 0) {
            contextMap.topics = topics;
        }
        
        // Detectar sentimiento con algoritmo mejorado
        const sentiment = analyzeSentimentImproved(message);
        contextMap.sentiment = sentiment;
        
        // Analizar estructura del mensaje (pregunta, comando, declaración)
        const structure = analyzeMessageStructure(message);
        contextMap.messageStructure = structure;
        
        // Detectar consultas de información específicas
        if (structure.isQuestion) {
            const questionType = categorizeQuestion(message);
            contextMap.questionType = questionType;
        }
    } catch (error) {
        console.error('ContextAnalyzer: Error al extraer información semántica:', error);
        // No propagar error para permitir análisis parcial
    }
}

/**
 * Enriquece el contexto con información de documentos relevantes
 * @param {string} conversationId - ID de la conversación
 * @param {string} message - Mensaje del usuario
 * @param {Object} contextMap - Mapa de contexto a enriquecer
 * @returns {Promise<void>}
 * @private
 */
async function enrichWithDocumentContext(conversationId, message, contextMap) {
    try {
        // Obtener documentos de la conversación con reintentos
        const documents = await withRetry(() => 
            documentProcessor.getConversationDocuments(conversationId)
        );
        
        if (!documents || documents.length === 0) {
            return; // No hay documentos para enriquecer
        }
        
        // Añadir resumen de documentos al contexto
        contextMap.availableDocuments = documents.map(doc => ({
            id: doc.id,
            name: doc.originalName,
            format: doc.format,
            uploadDate: doc.uploadDate,
            summary: doc.summary ? doc.summary.substring(0, 200) : null
        }));
        
        // Vectorizar mensaje para comparación semántica
        const messageVector = vectorizeText(message);
        
        if (messageVector) {
            // Buscar documentos relevantes usando vectores semánticos
            const relevantDocuments = [];
            
            for (const doc of documents) {
                let relevanceScore = 0;
                
                // Si hay contenido textual, calcular similitud semántica con vectores
                if (doc.textContent) {
                    const docVector = vectorizeText(doc.textContent.substring(0, 5000)); // Limitar para rendimiento
                    if (docVector) {
                        const similarity = cosineSimilarity(messageVector, docVector);
                        relevanceScore += similarity * 0.6; // Peso alto para similitud semántica
                    }
                }
                
                // Verificar coincidencias en entidades
                if (doc.entities && Array.isArray(doc.entities) && contextMap.entities) {
                    for (const entity of contextMap.entities) {
                        if (doc.entities.some(e => e.name.toLowerCase() === entity.name.toLowerCase())) {
                            relevanceScore += 0.2;
                        }
                    }
                }
                
                // Verificar coincidencias en conceptos clave
                if (doc.keyConcepts && Array.isArray(doc.keyConcepts) && contextMap.topics) {
                    for (const topic of contextMap.topics) {
                        if (doc.keyConcepts.some(c => c.word.toLowerCase().includes(topic.name.toLowerCase()))) {
                            relevanceScore += 0.15;
                        }
                    }
                }
                
                if (relevanceScore > 0.1) { // Umbral mínimo de relevancia
                    relevantDocuments.push({
                        ...doc,
                        relevanceScore
                    });
                }
            }
            
            // Ordenar por relevancia y limitar a los más relevantes
            if (relevantDocuments.length > 0) {
                contextMap.relevantDocuments = relevantDocuments
                    .sort((a, b) => b.relevanceScore - a.relevanceScore)
                    .slice(0, 3);
            }
        }
    } catch (error) {
        console.error('ContextAnalyzer: Error al enriquecer con documentos:', error);
        // No propagar error para permitir análisis parcial
    }
}

/**
 * Analiza las relaciones del mensaje actual con mensajes anteriores
 * @param {Object} contextMap - Mapa de contexto a enriquecer
 * @returns {Promise<void>}
 * @private
 */
async function analyzeMessageRelationships(contextMap) {
    try {
        const { currentMessage, recentMessages } = contextMap;
        if (!recentMessages || recentMessages.length === 0) {
            return;
        }
        
        // Solo analizar los N mensajes más recientes
        const messagesToAnalyze = recentMessages.slice(-MAX_CONTEXT_MESSAGES);
        
        // Detectar referencias a mensajes anteriores
        const references = [];
        let isFollowUp = false;
        
        // Análisis mejorado de referencias y seguimientos
        
        // 1. Verificar indicadores de seguimiento
        
        // Pronombres o referencias implícitas (mejorado)
        const pronounPatterns = [
            /\b(él|ella|ellos|ellas)\b/i,                                // Pronombres personales
            /\b(este|esta|esto|estos|estas|eso|esos|esas)\b/i,           // Demostrativos
            /\b(lo|los|las|le|les|su|sus|suyo|suya|suyos|suyas)\b/i,     // Posesivos y objeto directo/indirecto
            /\b(aquel|aquella|aquello|aquellos|aquellas)\b/i,            // Demostrativos lejanos
            /\b(dicho|dicha|dichos|dichas|mencionado|mencionada|citado|citada)\b/i // Referencias explícitas
        ];
        
        const hasPronounsOrReferences = pronounPatterns.some(pattern => pattern.test(currentMessage));
        
        // Referencias temporales o secuenciales (ampliado)
        const sequentialPatterns = [
            /\b(antes|después|luego|anteriormente|previamente)\b/i,      // Temporales
            /\b(primero|segundo|siguiente|último|finalmente)\b/i,        // Ordinales
            /\b(entonces|ahora|ya|también|además|asimismo)\b/i,          // Conectores
            /\b(igual|igualmente|de la misma forma|del mismo modo)\b/i,  // Comparativos
            /\b(en ese caso|si es así|por lo tanto|en consecuencia)\b/i  // Condicionales/consecuencia
        ];
        
        const hasSequentialReferences = sequentialPatterns.some(pattern => pattern.test(currentMessage));
        
        // Verificar si el mensaje es muy corto (posible respuesta a algo anterior)
        const isShortMessage = currentMessage.split(/\s+/).length <= 5;
        
        // Verificar si el mensaje comienza con verbo (posible comando continuando una acción previa)
        const verbPatterns = [
            /^(muestra|explica|dime|continúa|sigue|busca|analiza|compara|calcula|expande|elabora|desarrolla|profundiza)/i,
            /^(entonces|así que|por eso|de acuerdo|ok|vale|bien)/i
        ];
        
        const startsWithVerbOrAcknowledgment = verbPatterns.some(pattern => pattern.test(currentMessage.trim()));
        
        // 2. Determinar si es un seguimiento
        
        // Si el mensaje comienza con "y ", "pero ", o "o " es muy probable que sea seguimiento
        const startsWithConjunction = /^(y|pero|o|aunque|sin embargo|no obstante|por cierto)\s/i.test(currentMessage.trim());
        
        // Verificar si hay una respuesta a una sugerencia o petición previa del bot
        const responsesToSuggestion = [
            /^(sí|si|claro|por supuesto|ok|vale|de acuerdo|no|nop)/i,
            /^(me parece bien|está bien|perfecto|exacto|correcto|eso mismo)/i,
        ];
        
        const isResponseToSuggestion = responsesToSuggestion.some(pattern => pattern.test(currentMessage.trim()));
        
        // 3. Combinación de factores con pesos
        let followUpScore = 0;
        if (hasPronounsOrReferences) followUpScore += 0.5;
        if (hasSequentialReferences) followUpScore += 0.4;
        if (isShortMessage) followUpScore += 0.3;
        if (startsWithVerbOrAcknowledgment) followUpScore += 0.6;
        if (startsWithConjunction) followUpScore += 0.7;
        if (isResponseToSuggestion) followUpScore += 0.8;
        
        isFollowUp = followUpScore >= 0.7; // Umbral para considerar seguimiento
        
        // 4. Si parece un seguimiento, identificar mensaje(s) referenciado(s)
        if (isFollowUp) {
            // Encontrar mensajes previos relevantes
            let userMessages = messagesToAnalyze.filter(msg => msg.role === 'user');
            let botMessages = messagesToAnalyze.filter(msg => msg.role === 'bot');
            
            // Si es una respuesta muy corta, probablemente se refiere al último mensaje del bot
            if (isShortMessage && botMessages.length > 0) {
                references.push({
                    messageIndex: messagesToAnalyze.indexOf(botMessages[botMessages.length - 1]),
                    confidence: 0.85,
                    type: 'response'
                });
            }
            
            // Si tiene referencias pronominales, probablemente se refiere al contexto más reciente
            if (hasPronounsOrReferences) {
                // Añadir los dos últimos mensajes como contexto relevante
                const recentContext = messagesToAnalyze.slice(-2);
                recentContext.forEach((msg, idx) => {
                    references.push({
                        messageIndex: messagesToAnalyze.length - 2 + idx,
                        confidence: 0.75 - (idx * 0.1), // La más reciente tiene mayor confianza
                        type: 'contextual'
                    });
                });
            }
        }
        
        // 5. Análisis semántico de similitud con mensajes previos usando vectores de embeddings
        const currentVector = vectorizeText(currentMessage);
        
        if (currentVector) {
            messagesToAnalyze.forEach((msg, index) => {
                if (msg.role === 'bot') {
                    const msgVector = vectorizeText(msg.content);
                    
                    if (msgVector) {
                        // Calcular similitud coseno
                        const similarity = cosineSimilarity(currentVector, msgVector);
                        
                        if (similarity > SIMILARITY_THRESHOLD * 0.7) { // Usar umbral ajustado
                            references.push({
                                messageIndex: index,
                                confidence: Math.min(0.9, similarity + 0.1),
                                type: 'semantic',
                                similarity
                            });
                        }
                    }
                }
            });
        }
        
        // 6. Consolidar y ordenar referencias
        if (references.length > 0) {
            // Eliminar duplicados (mismo índice de mensaje)
            const uniqueRefs = [];
            const seenIndices = new Set();
            
            references.forEach(ref => {
                if (!seenIndices.has(ref.messageIndex)) {
                    uniqueRefs.push(ref);
                    seenIndices.add(ref.messageIndex);
                }
            });
            
            contextMap.references = uniqueRefs
                .sort((a, b) => b.confidence - a.confidence)
                .slice(0, 3); // Mantener solo las 3 referencias más confiables
                
            contextMap.isFollowUp = isFollowUp;
            contextMap.followUpScore = followUpScore;
        }
    } catch (error) {
        console.error('ContextAnalyzer: Error al analizar relaciones de mensajes:', error);
    }
}

/**
 * Actualiza la memoria y el contexto después de recibir una respuesta
 * @param {string} conversationId - ID de la conversación
 * @param {string} userId - ID del usuario (opcional)
 * @param {Object} contextMap - Mapa de contexto actual
 * @param {string} userMessage - Mensaje del usuario
 * @param {string} botResponse - Respuesta del bot
 * @returns {Promise<Object>} Contexto actualizado
 */
async function updateAfterResponse(conversationId, userId, contextMap, userMessage, botResponse) {
    try {
        if (!contextMap || !conversationId) {
            return {};
        }
        
        // Extraer información de la respuesta del bot utilizando el idioma detectado
        const lang = contextMap.language?.code || 'es';
        
        // Extraer entidades con NLP avanzado
        const responseEntities = await extractEntitiesWithNLP(botResponse, lang);
        
        // Extraer temas de la respuesta
        const responseTopics = extractTopics(botResponse);
        
        // Combinar entidades del mensaje y la respuesta
        const allEntities = [...(contextMap.entities || [])];
        
        // Añadir nuevas entidades de la respuesta sin duplicar
        if (responseEntities && responseEntities.length > 0) {
            responseEntities.forEach(entity => {
                if (!allEntities.some(e => e.name.toLowerCase() === entity.name.toLowerCase())) {
                    allEntities.push(entity);
                }
            });
        }
        
        // Combinar temas
        const allTopics = [...(contextMap.topics || [])];
        
        if (responseTopics && responseTopics.length > 0) {
            responseTopics.forEach(topic => {
                if (!allTopics.some(t => t.name === topic.name)) {
                    allTopics.push(topic);
                }
            });
        }
        
        // Ordenar temas por confianza
        const sortedTopics = allTopics
            .sort((a, b) => b.confidence - a.confidence)
            .slice(0, MAX_TOPICS);
        
        // Crear objeto de memoria mejorado
        const memoryItem = {
            userMessage,
            botResponse,
            entities: allEntities,
            timestamp: new Date().toISOString(),
            topics: sortedTopics,
            sentiment: contextMap.sentiment || null,
            intent: contextMap.intent || null,
            language: contextMap.language || null,
            isFollowUp: contextMap.isFollowUp || false
        };
        
        // Si hay documentos relevantes, incluirlos en memoria
        if (contextMap.relevantDocuments && contextMap.relevantDocuments.length > 0) {
            memoryItem.relevantDocuments = contextMap.relevantDocuments.map(doc => ({
                id: doc.id,
                name: doc.originalName,
                relevance: doc.relevanceScore
            }));
        }
        
        // Actualizar memoria con la interacción completa, con reintentos
        try {
            await withRetry(() => memoryStore.updateMemory(conversationId, userId, memoryItem));
        } catch (memoryError) {
            console.error('ContextAnalyzer: Error al actualizar memoria:', memoryError);
        }
        
        // Actualizar contexto para referencia futura
        contextMap.lastUpdate = new Date().toISOString();
        contextMap.lastBotResponse = {
            content: botResponse,
            entities: responseEntities,
            topics: responseTopics
        };
        
        await saveContextMap(conversationId, contextMap);
        
        return contextMap;
    } catch (error) {
        console.error('ContextAnalyzer: Error en actualización post-respuesta:', error);
        return contextMap || {};
    }
}

/**
 * Extrae temas principales de un texto con algoritmo mejorado
 * @param {string} text - Texto a analizar
 * @returns {Array} Lista de temas detectados
 * @private
 */
function extractTopics(text) {
    try {
        if (!text || text.trim() === '') {
            return [];
        }
        
        // Lista extendida de temas comunes para la detección
        const commonTopics = [
            // Tecnología y ciencia
            { 
                name: 'tecnología', 
                keywords: ['tecnología', 'tech', 'digital', 'dispositivo', 'electrónica', 'gadget', 'computadora', 
                          'ordenador', 'smartphone', 'móvil', 'celular', 'internet', 'wifi', 'hardware', 'software'] 
            },
            { 
                name: 'programación', 
                keywords: ['programación', 'código', 'desarrollador', 'software', 'aplicación', 'web', 'app', 
                          'desarrollo', 'javascript', 'python', 'java', 'html', 'css', 'framework', 'api'] 
            },
            { 
                name: 'inteligencia artificial', 
                keywords: ['ia', 'inteligencia artificial', 'machine learning', 'ml', 'neural', 'modelo', 'chatgpt', 
                          'nlp', 'procesamiento lenguaje', 'redes neuronales', 'algoritmo', 'claude', 'gpt', 'llm', 
                          'transformers', 'deep learning', 'aprendizaje profundo', 'datos', 'dataset'] 
            },
            { 
                name: 'ciencia', 
                keywords: ['ciencia', 'científico', 'investigación', 'estudio', 'descubrimiento', 'laboratorio', 
                          'experimento', 'teoría', 'hipótesis', 'método científico', 'física', 'química', 'biología'] 
            },
            { 
                name: 'matemáticas', 
                keywords: ['matemáticas', 'cálculo', 'algebra', 'estadística', 'número', 'ecuación', 'geometría',
                          'fórmula', 'probabilidad', 'algoritmo', 'teorema', 'función', 'matrix', 'variable'] 
            },
            
            // Medicina y salud
            { 
                name: 'salud', 
                keywords: ['salud', 'médico', 'medicina', 'hospital', 'clínica', 'doctor', 'enfermedad', 'tratamiento',
                          'diagnóstico', 'paciente', 'síntoma', 'terapia', 'farmacéutico', 'bienestar', 'pandemia'] 
            },
            { 
                name: 'nutrición', 
                keywords: ['nutrición', 'alimento', 'dieta', 'comida', 'saludable', 'vitamina', 'proteína', 'vegano',
                          'vegetariano', 'orgánico', 'mineral', 'nutriente', 'metabolismo', 'calorías', 'alimentación'] 
            },
            
            // Humanidades
            { 
                name: 'historia', 
                keywords: ['historia', 'histórico', 'pasado', 'antiguo', 'época', 'siglo', 'medieval', 'prehistoria',
                          'arqueología', 'civilización', 'imperio', 'guerra', 'revolución', 'cultura', 'patrimonio'] 
            },
            { 
                name: 'literatura', 
                keywords: ['literatura', 'libro', 'novela', 'autor', 'escritor', 'leer', 'poesía', 'poema', 'ficción',
                          'narrativa', 'texto', 'obra', 'publicación', 'editorial', 'biografía', 'ensayo'] 
            },
            { 
                name: 'arte', 
                keywords: ['arte', 'pintura', 'museo', 'artista', 'obra', 'creatividad', 'escultura', 'galería',
                          'exposición', 'diseño', 'estética', 'movimiento artístico', 'arquitectura', 'restauración'] 
            },
            { 
                name: 'música', 
                keywords: ['música', 'canción', 'banda', 'concierto', 'instrumento', 'melodía', 'ritmo', 'cantante',
                          'compositor', 'álbum', 'orquesta', 'sinfonía', 'armonía', 'acústica', 'nota musical'] 
            },
            
            // Negocios y economía
            { 
                name: 'negocios', 
                keywords: ['negocio', 'empresa', 'emprendimiento', 'startup', 'corporación', 'compañía', 'mercado',
                          'cliente', 'servicio', 'producto', 'marca', 'marketing', 'ventas', 'emprendedor', 'comercio'] 
            },
            { 
                name: 'economía', 
                keywords: ['economía', 'finanzas', 'mercado', 'inversión', 'bolsa', 'dinero', 'banco', 'crédito',
                          'préstamo', 'acciones', 'capital', 'inflación', 'recesión', 'fiscal', 'impuesto', 'deuda'] 
            },
            
            // Otros
            { 
                name: 'viajes', 
                keywords: ['viaje', 'turismo', 'destino', 'vacaciones', 'hotel', 'país', 'turista', 'aeropuerto',
                          'vuelo', 'playa', 'montaña', 'excursión', 'aventura', 'hospedaje', 'extranjero', 'guía'] 
            },
            { 
                name: 'deportes', 
                keywords: ['deporte', 'fútbol', 'baloncesto', 'tenis', 'competición', 'atleta', 'olímpico', 'torneo',
                          'partido', 'equipo', 'juego', 'campeonato', 'liga', 'estadio', 'fitness', 'ejercicio'] 
            },
            { 
                name: 'educación', 
                keywords: ['educación', 'escuela', 'universidad', 'aprendizaje', 'estudiar', 'enseñar', 'alumno',
                          'estudiante', 'profesor', 'colegio', 'academia', 'curso', 'grado', 'formación', 'docente'] 
            },
            { 
                name: 'política', 
                keywords: ['política', 'gobierno', 'elecciones', 'partido', 'estado', 'ley', 'presidente', 'ministro',
                          'congreso', 'senado', 'democracia', 'votación', 'campaña', 'constitución', 'decreto'] 
            },
            { 
                name: 'medio ambiente', 
                keywords: ['ambiente', 'ecología', 'clima', 'sostenible', 'planeta', 'verde', 'contaminación',
                          'reciclaje', 'renovable', 'biodiversidad', 'conservación', 'ecosistema', 'naturaleza'] 
            },
            {
                name: 'psicología',
                keywords: ['psicología', 'mente', 'comportamiento', 'cognitivo', 'emocional', 'terapia', 'mental',
                           'psicólogo', 'trauma', 'ansiedad', 'depresión', 'trastorno', 'bienestar', 'conducta']
            }
        ];
        
        const lowerText = text.toLowerCase();
        const detectedTopics = [];
        
        // Separar texto en palabras para análisis
        const textWords = lowerText
            .replace(/[^\wáéíóúüñ\s]/g, ' ')
            .split(/\s+/)
            .filter(w => w.length > 3);
        
        // Detectar temas basados en palabras clave
        commonTopics.forEach(topic => {
            // Verificar coincidencias con las palabras clave
            const matchingKeywords = topic.keywords.filter(keyword => 
                // Buscar coincidencias exactas de palabra
                textWords.includes(keyword) ||
                // Buscar coincidencias parciales para palabras compuestas
                (keyword.includes(' ') && lowerText.includes(keyword))
            );
            
            const matchCount = matchingKeywords.length;
            
            if (matchCount > 0) {
                // Calcular confianza basada en número y calidad de coincidencias
                const baseConfidence = Math.min(0.9, 0.5 + (matchCount / topic.keywords.length) * 0.5);
                
                // Ajuste por densidad (más importante en textos cortos)
                const densityFactor = Math.min(1, matchCount / (textWords.length / 10 + 1));
                
                // Confianza final
                const confidence = baseConfidence * (0.7 + 0.3 * densityFactor);
                
                detectedTopics.push({
                    name: topic.name,
                    confidence: confidence,
                    matchedKeywords: matchingKeywords
                });
            }
        });
        
        // Ordenar por confianza y limitar a los principales
        return detectedTopics
            .sort((a, b) => b.confidence - a.confidence)
            .slice(0, MAX_TOPICS);
    } catch (error) {
        console.error('ContextAnalyzer: Error al extraer temas:', error);
        return [];
    }
}

/**
 * Detecta la intención del mensaje con algoritmo mejorado
 * @param {string} message - Mensaje a analizar
 * @returns {Object} Intención detectada
 * @private
 */
function detectIntent(message) {
    try {
        const lowerMsg = message.toLowerCase().trim();
        
        // Estructura para patrones de intención mejorados
        const intentPatterns = [
            { 
                name: 'buscar_información', 
                patterns: [
                    /(?:qué|quién|cómo|dónde|cuándo|por qué|cuál|cuánto|cuánta|cuántos|cuántas)\s+.+\??/i,
                    /(?:busca|buscar|encontrar|hallar|localizar|investigar)\s+.+/i,
                    /(?:información|datos|detalles|estadísticas|referencias|fuentes)\s+(?:sobre|acerca|de)\s+.+/i,
                    /(?:me puedes|podrías|pudieras|podrás|me podrías)\s+(?:decir|informar|contar|indicar|explicar)\s+.+\??/i,
                    /(?:necesito|quiero|quisiera|me gustaría)\s+(?:saber|conocer|entender|comprender)\s+.+/i
                ],
                examples: ["¿Qué es la inteligencia artificial?", "Busca información sobre el cambio climático", 
                           "Dime quién inventó Internet", "Necesito saber cómo funciona un motor eléctrico"],
                confidence: 0.85
            },
            { 
                name: 'generar_contenido', 
                patterns: [
                    /(?:crear|generar|escribir|redactar|producir|elaborar|desarrollar)\s+(?:un|una|el|la|los|las)?\s+.+/i,
                    /(?:escribe|genera|crea|produce|redacta|haz|elabora|desarrolla)\s+.+/i,
                    /(?:necesito|quiero|quisiera|me gustaría)\s+(?:un|una)\s+(?:texto|código|historia|ejemplo|guía|resumen|informe|carta|correo|análisis|presentación|script|documento|plan)/i,
                    /(?:ayúdame a|ayuda con|asísteme con)\s+(?:escribir|crear|redactar|generar|elaborar)\s+.+/i,
                    /(?:dame|proporciona|elabora)\s+(?:un|una)\s+(?:lista|resumen|síntesis|outline|esquema|borrador|propuesta)/i
                ],
                examples: ["Escribe una historia corta de ciencia ficción", "Genera un poema sobre la naturaleza", 
                           "Necesito un correo de renuncia formal", "Ayúdame a crear un plan de negocios"],
                confidence: 0.8
            },
            { 
                name: 'solicitar_opinión', 
                patterns: [
                    /(?:qué opinas|qué piensas|cuál es tu opinión|qué te parece|cómo ves)\s+.+\??/i,
                    /(?:crees que|piensas que|consideras que|opinas que)\s+.+\??/i,
                    /(?:estás de acuerdo|coincides) con\s+.+\??/i,
                    /(?:dame tu|me interesa tu|podrías darme tu|cuál sería tu)\s+(?:opinión|punto de vista|perspectiva|visión)\s+.+/i,
                    /(?:según tu|desde tu|en tu|basado en tu)\s+(?:opinión|punto de vista|perspectiva|criterio|análisis)/i
                ],
                examples: ["¿Qué opinas sobre la energía nuclear?", "¿Crees que la IA puede ser peligrosa?", 
                           "Dame tu punto de vista sobre el teletrabajo", "¿Estás de acuerdo con esta decisión?"],
                confidence: 0.75
            },
            { 
                name: 'acción_comando', 
                patterns: [
                    /^(?:haz|realiza|ejecuta|calcula|analiza|procesa|traduce|convierte|simula|transforma|resuelve|soluciona)\s+.+/i,
                    /^(?:puedes|podrías)\s+(?:hacer|realizar|ejecutar|calcular|analizar|procesar|traducir|convertir|simular|transformar|resolver|solucionar)\s+.+/i,
                    /^(?:por favor|favor de|te pido que|necesito que)\s+(?:hagas|realices|ejecutes|calcules|analices|proceses|traduzcas|conviertas)\s+.+/i,
                    /(?:resuelve|soluciona|calcula)\s+(?:este|esta|el|la|siguiente|problema|ejercicio|ecuación|operación)/i,
                    /(?:traduce|convierte|transforma)\s+(?:esto|esta|este|texto|párrafo|frase|lo siguiente)/i
                ],
                examples: ["Calcula la raíz cuadrada de 144", "Traduce este texto al francés", 
                           "Analiza la siguiente frase", "Resuelve esta ecuación: 3x+5=20"],
                confidence: 0.85
            },
            { 
                name: 'saludar', 
                patterns: [
                    /^(?:hola|hey|saludos|buenos días|buenas tardes|buenas noches|qué tal|qué hay|cómo estás|cómo vas|hi|hello)(?:\s|$|\W)/i,
                    /^(?:un saludo|un gusto saludarte|encantado de conocerte|mucho gusto|es un placer)/i,
                    /^(?:me alegra|me da gusto|feliz de) (?:verte|saludarte|hablarte|contactarte|conversar)/i
                ],
                examples: ["Hola, ¿cómo estás?", "Buenos días", "Hey, ¿qué tal?", "Saludos desde México"],
                confidence: 0.95
            },
            { 
                name: 'agradecer', 
                patterns: [
                    /^(?:gracias|te agradezco|muchas gracias|mil gracias|thank you|thanks|agradecido|agradecida)(?:\s|$|\W)/i,
                    /^(?:te lo agradezco|gracias por tu|gracias por la|gracias por todo|excelente, gracias)/i,
                    /(?:aprecio|valoro|estoy agradecido por|estoy agradecida por) (?:tu ayuda|tu apoyo|tu soporte|tu respuesta|tu tiempo)/i
                ],
                examples: ["Gracias por la información", "Muchas gracias", "Te agradezco tu ayuda", "Excelente respuesta, gracias"],
                confidence: 0.95
            },
            { 
                name: 'despedirse', 
                patterns: [
                    /^(?:adiós|hasta luego|hasta pronto|nos vemos|chao|bye|hasta mañana|hasta la próxima)(?:\s|$|\W)/i,
                    /^(?:me despido|tengo que irme|debo retirarme|eso es todo|terminamos|finalicemos|ha sido todo)/i,
                    /(?:fue un|ha sido un) (?:placer|gusto|agrado|honor)/i
                ],
                examples: ["Adiós, gracias por todo", "Hasta la próxima", "Me tengo que ir, gracias", "Nos vemos pronto"],
                confidence: 0.9
            },
            {
                name: 'confirmar',
                patterns: [
                    /^(?:sí|si|claro|por supuesto|definitivamente|afirmativo|efectivamente|exacto|exactamente|correcto|así es)(?:\s|$|\W)/i,
                    /^(?:estoy de acuerdo|coincido|concuerdo|lo confirmo|así es|tienes razón|estás en lo correcto)/i,
                    /^(?:me parece bien|suena bien|suena perfecto|perfecto|excelente|genial|fantástico|increíble)(?:\s|$|\W)/i
                ],
                examples: ["Sí, por favor", "Claro, continúa", "Por supuesto, me encantaría", "Estoy de acuerdo"],
                confidence: 0.9
            },
            {
                name: 'negar',
                patterns: [
                    /^(?:no|nope|para nada|en absoluto|negativo|de ninguna manera|jamás|nunca)(?:\s|$|\W)/i,
                    /^(?:no estoy de acuerdo|discrepo|difiero|no coincido|no concuerdo)/i,
                    /^(?:no me parece|no creo|no pienso|no considero|me niego)/i
                ],
                examples: ["No, eso no es correcto", "Para nada", "No estoy de acuerdo con esa afirmación", "No quiero hacer eso"],
                confidence: 0.9
            },
            {
                name: 'aclarar',
                patterns: [
                    /(?:no entiendo|no comprendo|no me queda claro|estoy confundido|estoy confundida|podrías aclarar|puedes aclarar)/i,
                    /(?:qué quieres decir|a qué te refieres|podrías explicar mejor|puedes explicar mejor|podrías detallar|puedes detallar)/i,
                    /(?:no te sigo|me perdí|no estoy seguro de entender|no estoy segura de entender|qué significa)/i
                ],
                examples: ["No entiendo, ¿podrías explicarlo de otra forma?", "¿A qué te refieres con eso?", 
                           "Estoy confundido, ¿puedes aclarar?", "¿Qué significa ese término?"],
                confidence: 0.85
            }
        ];
        
        // Sistema de puntuación ponderada para intenciones
        const scores = {};
        let highestScore = 0;
        let detectedIntent = null;
        
        // Verificar cada patrón de intención
        intentPatterns.forEach(intent => {
            let intentScore = 0;
            
            intent.patterns.forEach(pattern => {
                if (pattern.test(lowerMsg)) {
                    // Sumar puntuación base
                    const matchScore = intent.confidence * 0.7;
                    intentScore = Math.max(intentScore, matchScore);
                    
                    // Añadir extra por coincidencia al inicio del mensaje
                    if (pattern.test(lowerMsg.substring(0, Math.min(lowerMsg.length, 15)))) {
                        intentScore += 0.1;
                    }
                }
            });
            
            // Si hay puntuación para esta intención, guardarla
            if (intentScore > 0) {
                scores[intent.name] = intentScore;
                
                if (intentScore > highestScore) {
                    highestScore = intentScore;
                    detectedIntent = {
                        name: intent.name,
                        confidence: intentScore
                    };
                }
            }
        });
        
        // Si no se detectó intención específica
        if (!detectedIntent) {
            return {
                name: 'conversar',
                confidence: 0.5
            };
        }
        
        return detectedIntent;
    } catch (error) {
        console.error('ContextAnalyzer: Error al detectar intención:', error);
        return {
            name: 'desconocida',
            confidence: 0.3
        };
    }
}

/**
 * Analiza el sentimiento del mensaje con algoritmo mejorado
 * @param {string} message - Mensaje a analizar
 * @returns {Object} Sentimiento detectado
 * @private
 */
function analyzeSentimentImproved(message) {
    try {
        // Palabras positivas en español - Lista extendida
        const positiveWords = [
            // Términos básicos positivos
            'bien', 'bueno', 'excelente', 'fantástico', 'increíble', 'maravilloso', 'genial', 'alegre', 
            'feliz', 'contento', 'encantado', 'fascinante', 'agradable', 'positivo', 'optimista', 
            'satisfecho', 'perfecto', 'espectacular', 'brillante', 'asombroso', 'impresionante',
            
            // Expresiones de gratitud
            'gracias', 'agradecido', 'aprecio', 'valoro', 'reconozco',
            
            // Conceptos positivos
            'éxito', 'logro', 'triunfo', 'progreso', 'avance', 'mejora', 'beneficio', 'ventaja',
            'oportunidad', 'facilidad', 'simplicidad', 'claridad', 'equilibrio', 'armonía',
            
            // Emociones positivas
            'amor', 'amistad', 'confianza', 'esperanza', 'ilusión', 'motivación', 'entusiasmo',
            'interés', 'diversión', 'risa', 'pasión', 'emoción', 'sorpresa', 'admiración', 'respeto',
            
            // Intensificadores positivos
            'muy', 'bastante', 'sumamente', 'extremadamente', 'absolutamente', 'completamente',
            'totalmente', 'genuinamente',
            
            // Expresiones coloquiales positivas
            'genial', 'chévere', 'estupendo', 'magnífico', 'bárbaro', 'fabuloso', 'fenomenal',
            'formidable', 'grandioso', 'guay', 'tremendo', 'espléndido', 'extraordinario'
        ];
        
        // Palabras negativas en español - Lista extendida
        const negativeWords = [
            // Términos básicos negativos
            'mal', 'malo', 'terrible', 'horrible', 'pésimo', 'deficiente', 'desastre', 'triste', 
            'deprimido', 'enojado', 'furioso', 'irritado', 'preocupado', 'ansioso', 'estresado', 
            'decepcionado', 'molesto', 'disgustado', 'aterrador', 'frustrado', 'doloroso',
            
            // Conceptos negativos
            'problema', 'dificultad', 'obstáculo', 'barrera', 'limitación', 'restricción',
            'complicación', 'desventaja', 'perjuicio', 'daño', 'riesgo', 'amenaza', 'crisis',
            'conflicto', 'desacuerdo', 'disputa', 'error', 'falla', 'defecto',
            
            // Emociones negativas
            'miedo', 'temor', 'pánico', 'terror', 'horror', 'angustia', 'ansiedad', 'nerviosismo',
            'inquietud', 'tristeza', 'melancolía', 'nostalgia', 'desesperación', 'soledad',
            'rechazo', 'abandono', 'culpa', 'vergüenza', 'humillación', 'remordimiento',
            'resentimiento', 'enfado', 'ira', 'rabia', 'furia', 'indignación', 'odio', 'desprecio',
            'asco', 'repulsión', 'aversión', 'repugnancia',
            
            // Intensificadores negativos
            'demasiado', 'excesivamente', 'extremadamente', 'absolutamente', 'completamente',
            'totalmente', 'profundamente', 'intensamente',
            
            // Términos de rechazo
            'no', 'nunca', 'jamás', 'nada', 'nadie', 'ninguno', 'negativo', 'imposible',
            'inaceptable', 'inadmisible', 'indeseable', 'inviable', 'absurdo'
        ];
        
        // Palabras de confusión/incertidumbre - Lista extendida
        const confusionWords = [
            // Estados de confusión
            'confuso', 'confundido', 'perdido', 'desorientado', 'inseguro', 'dudoso', 'incierto',
            'indeciso', 'ambiguo', 'vago', 'impreciso', 'indefinido', 'inconsistente', 'contradictorio',
            
            // Expresiones de incomprensión
            'no entiendo', 'no comprendo', 'difícil de entender', 'incomprensible', 'ininteligible',
            'no tiene sentido', 'sin sentido', 'ilógico', 'irracional', 'inexplicable',
            
            // Preguntas de aclaración
            '¿qué quieres decir?', '¿a qué te refieres?', '¿puedes explicar?', '¿puedes aclarar?',
            '¿cómo así?', '¿en qué sentido?',
            
            // Estados cognitivos de incertidumbre
            'duda', 'incertidumbre', 'vacilación', 'titubeo', 'quizás', 'tal vez', 'posiblemente',
            'probablemente', 'supongo', 'imagino', 'asumo', 'creo que', 'me parece que',
            
            // Complejidad y dificultad
            'complicado', 'complejo', 'difícil', 'enrevesado', 'intrincado', 'laberíntico',
            'enredado', 'embrollado', 'desconcertante', 'problemático'
        ];
        
        // Palabras de urgencia - Lista extendida
        const urgencyWords = [
            // Términos de urgencia directa
            'urgente', 'inmediato', 'rápido', 'pronto', 'emergencia', 'ahora', 'ya', 'enseguida',
            'cuanto antes', 'sin demora', 'sin dilación', 'sin tardanza', 'con urgencia',
            
            // Expresiones temporales de urgencia
            'no hay tiempo', 'se acaba el tiempo', 'contrarreloj', 'inmediatamente', 'en este momento',
            'ahora mismo', 'de inmediato', 'a la brevedad', 'lo antes posible', 'tan pronto como',
            
            // Términos de prioridad
            'prioritario', 'prioridad', 'primordial', 'crucial', 'vital', 'crítico', 'esencial',
            'indispensable', 'imperativo', 'apremiante', 'perentorio',
            
            // Plazos y límites
            'plazo', 'fecha límite', 'vencimiento', 'deadline', 'antes de', 'para ayer',
            'último momento', 'tiempo límite', 'cuenta atrás', 'contra el tiempo',
            
            // Expresiones de necesidad inmediata
            'necesito ya', 'necesito ahora', 'requiero inmediatamente', 'exijo de inmediato',
            'demando urgentemente', 'solicito con urgencia'
        ];
        
        // Patrones directos de emociones (expresiones completas)
        const emotionPatterns = [
            // Patrones de felicidad
            {
                emotion: 'positive',
                patterns: [
                    /(?:me siento|estoy|me encuentro) (?:feliz|contento|alegre|entusiasmado|emocionado|motivado)/i,
                    /(?:me encanta|me fascina|me apasiona|disfruto|amo|adoro) .+/i,
                    /(?:qué buena noticia|excelentes noticias|fantástico|genial|maravilloso|brillante)/i
                ],
                weight: 0.8
            },
            // Patrones de tristeza
            {
                emotion: 'negative',
                patterns: [
                    /(?:me siento|estoy|me encuentro) (?:triste|deprimido|abatido|decaído|melancólico|desanimado)/i,
                    /(?:me duele|me lastima|me hiere|sufro por|padezco) .+/i,
                    /(?:qué mala noticia|terrible noticia|qué desgracia|qué pena|qué lástima|qué decepción)/i
                ],
                weight: 0.8
            },
            // Patrones de ira
            {
                emotion: 'negative',
                patterns: [
                    /(?:me siento|estoy|me encuentro) (?:enojado|enfadado|furioso|irritado|cabreado|molesto)/i,
                    /(?:me indigna|me enfurece|me irrita|me molesta|me cabrea|me fastidia) .+/i,
                    /(?:esto es indignante|qué indignación|es el colmo|es inadmisible|es inconcebible)/i
                ],
                weight: 0.85
            },
            // Patrones de confusión
            {
                emotion: 'confused',
                patterns: [
                    /(?:me siento|estoy|me encuentro) (?:confundido|confusa|perdido|perdida|desorientado|desorientada)/i,
                    /(?:no entiendo|no comprendo|no me queda claro|no logro entender) .+/i,
                    /(?:puedes explicar|podrías aclarar|no sé a qué te refieres|qué quieres decir)/i
                ],
                weight: 0.85
            },
            // Patrones de urgencia
            {
                emotion: 'urgent',
                patterns: [
                    /(?:necesito|requiero|preciso) (?:urgentemente|con urgencia|inmediatamente|ya|ahora) .+/i,
                    /(?:es urgente|es prioritario|no puede esperar|hay prisa|corre prisa) .+/i,
                    /(?:para ayer|lo necesito ya|fecha límite|deadline|a más tardar|cuanto antes)/i
                ],
                weight: 0.9
            },
            // Patrones de ansiedad
            {
                emotion: 'anxious',
                patterns: [
                    /(?:me siento|estoy|me encuentro) (?:ansioso|ansiosa|nervioso|nerviosa|preocupado|preocupada)/i,
                    /(?:me preocupa|me inquieta|me angustia|tengo miedo de|temo que) .+/i,
                    /(?:estoy estresado|estoy estresada|no puedo relajarme|me siento tenso|me siento tensa)/i
                ],
                weight: 0.8
            },
            // Patrones de gratitud
            {
                emotion: 'gratitude',
                patterns: [
                    /(?:gracias|te agradezco|muchas gracias|mil gracias|agradecido|agradecida)/i,
                    /(?:aprecio mucho|valoro mucho|estoy agradecido por|estoy agradecida por) .+/i,
                    /(?:te lo agradezco de corazón|infinitas gracias|no sé cómo agradecerte|muy amable)/i
                ],
                weight: 0.85
            }
        ];
        
        const lowerMsg = message.toLowerCase();
        const words = lowerMsg.split(/\W+/).filter(word => word.length > 2);
        
        // Analizar presencia de emociones directas con patrones
        let directEmotions = [];
        
        emotionPatterns.forEach(pattern => {
            pattern.patterns.forEach(regex => {
                if (regex.test(lowerMsg)) {
                    directEmotions.push({
                        emotion: pattern.emotion,
                        weight: pattern.weight
                    });
                }
            });
        });
        
        // Contar apariciones de palabras clave
        let positiveCount = 0;
        let negativeCount = 0;
        let confusionCount = 0;
        let urgencyCount = 0;
        
        words.forEach(word => {
            if (positiveWords.includes(word)) positiveCount++;
            if (negativeWords.includes(word)) negativeCount++;
            if (confusionWords.includes(word)) confusionCount++;
            if (urgencyWords.includes(word)) urgencyCount++;
        });
        
        // Verificar frases específicas para confusión
        confusionWords.forEach(phrase => {
            if (phrase.includes(' ') && lowerMsg.includes(phrase)) {
                confusionCount += 2; // Dar más peso a frases completas
            }
        });
        
        // Verificar la presencia de emojis (ampliado)
        const emojiPatterns = {
            positive: [
                /[\u{1F600}-\u{1F64F}]/u,         // Emojis emotivos
                /[\u{1F496}-\u{1F49D}]/u,         // Corazones
                /[\u{1F44D}\u{1F44F}\u{1F4AA}]/u, // Pulgares arriba, aplausos, bíceps
                /[:;][-]?[)D]|[)(][:;]/           // Emoticonos texto :) ;) :D
            ],
            negative: [
                /[\u{1F61E}-\u{1F62D}]/u,         // Caras tristes/enfadadas
                /[\u{1F494}\u{1F4A9}]/u,          // Corazón roto, caca
                /[:;][-]?[(]|[)(][:;]/            // Emoticonos texto :( ;(
            ]
        };
        
        emojiPatterns.positive.forEach(pattern => {
            if (pattern.test(message)) positiveCount += 1.5; // Mayor peso a emojis
        });
        
        emojiPatterns.negative.forEach(pattern => {
            if (pattern.test(message)) negativeCount += 1.5; // Mayor peso a emojis
        });
        
        // Calcular puntuación de sentimiento (-1 a +1)
        const totalWords = words.length || 1; // Evitar división por cero
        const baseSentimentScore = (positiveCount - negativeCount) / Math.sqrt(totalWords);
        
        // Ajustar por emociones directas detectadas
        let sentimentAdjustment = 0;
        
        directEmotions.forEach(emotion => {
            if (emotion.emotion === 'positive') {
                sentimentAdjustment += emotion.weight * 0.3;
            } else if (emotion.emotion === 'negative') {
                sentimentAdjustment -= emotion.weight * 0.3;
            }
        });
        
        // Puntuación final ajustada
        const sentimentScore = Math.max(-1, Math.min(1, baseSentimentScore + sentimentAdjustment));
        
        // Determinar sentimiento
        let sentiment = 'neutral';
        if (sentimentScore > 0.15) sentiment = 'positive';
        if (sentimentScore < -0.15) sentiment = 'negative';
        
        // Verificar emociones específicas
        if (confusionCount > totalWords * 0.1 || directEmotions.some(e => e.emotion === 'confused')) {
            sentiment = 'confused';
        }
        if (urgencyCount > 0 || directEmotions.some(e => e.emotion === 'urgent')) {
            sentiment = 'urgent';
        }
        if (directEmotions.some(e => e.emotion === 'anxious') && sentiment !== 'urgent') {
            sentiment = 'anxious';
        }
        if (directEmotions.some(e => e.emotion === 'gratitude') && sentiment !== 'urgent' && sentiment !== 'confused') {
            sentiment = 'gratitude';
        }
        
        // Calcular intensidad
        const intensity = Math.min(1.0, 0.5 + Math.abs(sentimentScore) * 0.5);
        
        return {
            sentiment,
            score: sentimentScore,
            intensity,
            stats: {
                positive: positiveCount,
                negative: negativeCount,
                confusion: confusionCount,
                urgency: urgencyCount,
                directEmotions: directEmotions.length
            },
            directEmotions: directEmotions.length > 0 ? directEmotions : undefined
        };
    } catch (error) {
        console.error('ContextAnalyzer: Error al analizar sentimiento:', error);
        return {
            sentiment: 'neutral',
            score: 0,
            intensity: 0
        };
    }
}

/**
 * Detecta el idioma del mensaje con algoritmo mejorado
 * @param {string} message - Mensaje a analizar
 * @returns {Object} Idioma detectado
 * @private
 */
function detectLanguageImproved(message) {
    try {
        if (!message || message.trim() === '') {
            return { code: 'es', name: 'Spanish', confidence: 0.5 };
        }
        
        // Palabras frecuentes por idioma (ampliado)
        const languageMarkers = {
            es: ['el', 'la', 'los', 'las', 'de', 'en', 'que', 'por', 'con', 'para', 'como', 'pero', 'más', 'este', 'qué', 'cuando', 'hay', 'ser', 'este', 'todo', 'muy', 'sin', 'sobre', 'entre', 'también', 'me', 'ya', 'hay', 'porque', 'sólo', 'años', 'tiempo', 'dos', 'bien', 'día', 'donde', 'yo', 'tu', 'así', 'vida', 'ahora', 'siempre', 'mientras', 'aunque', 'hasta', 'trabajo', 'esta', 'menos'],
            en: ['the', 'and', 'to', 'of', 'a', 'in', 'that', 'is', 'was', 'for', 'on', 'with', 'he', 'it', 'as', 'are', 'at', 'be', 'this', 'from', 'but', 'not', 'they', 'by', 'have', 'you', 'or', 'an', 'would', 'their', 'there', 'what', 'about', 'which', 'when', 'we', 'she', 'your', 'one', 'all', 'will', 'can', 'my', 'has', 'been', 'who', 'more', 'do', 'if'],
            fr: ['le', 'la', 'les', 'un', 'une', 'des', 'de', 'du', 'en', 'et', 'est', 'que', 'pour', 'dans', 'qui', 'pas', 'sur', 'avec', 'au', 'ce', 'à', 'plus', 'par', 'sont', 'ou', 'mais', 'comme', 'nous', 'vous', 'ils', 'ces', 'cette', 'elle', 'tout', 'aussi', 'son', 'leur', 'sans', 'même', 'ont', 'être', 'fait', 'peut', 'était', 'quand', 'tous', 'faire', 'été', 'je'],
            pt: ['o', 'a', 'os', 'as', 'um', 'uma', 'de', 'do', 'da', 'dos', 'das', 'em', 'no', 'na', 'nos', 'nas', 'e', 'é', 'que', 'para', 'com', 'por', 'mas', 'se', 'não', 'como', 'mais', 'ao', 'ou', 'sua', 'seu', 'são', 'foi', 'pelo', 'pela', 'isso', 'este', 'esta', 'ele', 'ela', 'quando', 'tem', 'ser', 'muito', 'já', 'há', 'só', 'sem', 'fazer'],
            it: ['il', 'lo', 'la', 'i', 'gli', 'le', 'un', 'uno', 'una', 'di', 'del', 'della', 'dei', 'delle', 'in', 'nel', 'nella', 'nei', 'nelle', 'e', 'è', 'che', 'per', 'con', 'a', 'su', 'da', 'ma', 'non', 'sono', 'come', 'più', 'questo', 'questa', 'questi', 'queste', 'essere', 'sono', 'ha', 'ho', 'hanno', 'fatto', 'fa', 'fare', 'prima', 'anche', 'se', 'quando', 'o', 'al']
        };
        
        // Nombres completos de idiomas
        const languageNames = {
            es: 'Spanish',
            en: 'English',
            fr: 'French',
            pt: 'Portuguese',
            it: 'Italian'
        };
        
        // Limpiar texto para análisis
        const cleanText = message.toLowerCase()
            .replace(/[^\wáéíóúüñçàèìòùâêîôûäëïöüãõ\s]/gi, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        
        // Dividir mensaje en palabras
        const words = cleanText.split(/\s+/);
        
        // Contar coincidencias para cada idioma
        const scores = {};
        const matches = {};
        
        Object.keys(languageMarkers).forEach(langCode => {
            const markers = languageMarkers[langCode];
            matches[langCode] = [];
            
            // Contar palabras que coinciden con los marcadores
            words.forEach(word => {
                if (markers.includes(word)) {
                    matches[langCode].push(word);
                }
            });
            
            // Calcular puntuación normalizada
            scores[langCode] = words.length > 0 ? matches[langCode].length / words.length : 0;
        });
        
        // Detectar caracteres específicos de idiomas
        const charPatterns = {
            es: /[áéíóúüñ¿¡]/g,
            fr: /[çàèìòùâêîôûëïü]/g, 
            pt: /[ãõçáéíóú]/g,
            it: /[àèìòù]/g
        };
        
        Object.entries(charPatterns).forEach(([lang, pattern]) => {
            const charMatches = (message.match(pattern) || []).length;
            if (charMatches > 0) {
                scores[lang] += 0.1 + (charMatches * 0.02); // Bonus por caracteres específicos
            }
        });
        
        // Detectar patrones gramaticales específicos
        const grammarPatterns = {
            es: [/\b(el|la|los|las) [a-záéíóúñ]+\b/gi, /\b(muy|más) [a-záéíóúñ]+\b/gi, /\b(de|en|con|por|para) (el|la|los|las)?\b/gi],
            en: [/\b(the|a|an) [a-z]+\b/gi, /\b(more|very) [a-z]+\b/gi, /\b(of|in|with|by|for) (the|a|an)?\b/gi],
            fr: [/\b(le|la|les|un|une|des) [a-zàâäæçéèêëîïôœùûüÿ]+\b/gi, /\b(très|plus) [a-zàâäæçéèêëîïôœùûüÿ]+\b/gi],
            pt: [/\b(o|a|os|as|um|uma) [a-záàâãçéêíóôõú]+\b/gi, /\b(muito|mais) [a-záàâãçéêíóôõú]+\b/gi],
            it: [/\b(il|lo|la|i|gli|le|un|uno|una) [a-zàèéìíîòóùú]+\b/gi, /\b(molto|più) [a-zàèéìíîòóùú]+\b/gi]
        };
        
        Object.entries(grammarPatterns).forEach(([lang, patterns]) => {
            patterns.forEach(pattern => {
                const grammarMatches = (message.match(pattern) || []).length;
                if (grammarMatches > 0) {
                    scores[lang] += 0.05 + (grammarMatches * 0.01); // Bonus por patrones gramaticales
                }
            });
        });
        
        // Encontrar el idioma con mayor puntuación
        let detectedLang = 'es'; // Español por defecto
        let maxScore = scores.es || 0;
        
        Object.keys(scores).forEach(langCode => {
            if (scores[langCode] > maxScore) {
                maxScore = scores[langCode];
                detectedLang = langCode;
            }
        });
        
        // Por defecto, asumir español si no hay suficiente confianza
        if (maxScore < 0.1) {
            detectedLang = 'es';
            maxScore = 0.5;
        }
        
        // Calcular confianza normalizada
        const confidence = Math.min(0.99, maxScore + 0.3);
        
        return {
            code: detectedLang,
            name: languageNames[detectedLang],
            confidence: confidence,
            matches: matches[detectedLang]?.length || 0
        };
    } catch (error) {
        console.error('ContextAnalyzer: Error al detectar idioma:', error);
        return { code: 'es', name: 'Spanish', confidence: 0.5 };
    }
}

/**
 * Analiza la estructura del mensaje
 * @param {string} message - Mensaje a analizar
 * @returns {Object} Estructura detectada
 * @private
 */
function analyzeMessageStructure(message) {
    try {
        if (!message || message.trim() === '') {
            return { type: 'unknown', isQuestion: false };
        }
        
        const trimmed = message.trim();
        
        // Verificar si es una pregunta (mejorado)
        const questionPatterns = [
            /\?$/,                                     // Termina con signo de interrogación
            /^(?:qué|cuál|cómo|dónde|cuándo|quién|por qué|cuánto|cuántos|cuántas)\b/i,  // Comienza con palabra interrogativa
            /\b(?:me puedes|podrías|puedes|puede|sabes|sabrías) (?:decir|explicar|contar|informar)\b.*\??/i, // Pregunta indirecta
            /^(?:conoces|has oído|recuerdas|entiendes|comprendes)\b.*\??/i  // Pregunta de conocimiento
        ];
        
        const isQuestion = questionPatterns.some(pattern => pattern.test(trimmed));
        
        // Verificar si es un comando (mejorado)
        const commandPatterns = [
            /^(?:haz|muestra|genera|crea|calcula|explica|lista|enumera|analiza|encuentra|busca|traduce|convierte|compara|ejecuta|implementa|escribe|diseña)\b/i,
            /^(?:necesito que|quiero que|me gustaría que) (?:hagas|muestres|generes|crees|calcules|expliques|listes|enumeres|analices|encuentres|busques|traduzcas|conviertas|compares|ejecutes|implementes|escribas|diseñes)\b/i
        ];
        
        const isCommand = commandPatterns.some(pattern => pattern.test(trimmed));
        
        // Verificar si es una solicitud directa (mejorado)
        const requestPatterns = [
            /^(?:por favor|puedes|podrías|pudieras|te pido que|te solicito que|te agradecería que)\b/i,
            /^(?:me gustaría|quisiera|querría|desearía|necesito|requiero|solicito|pido)\b/i,
            /^(?:sería posible|es posible|habría forma de|hay manera de|existe algún modo de)\b/i
        ];
        
        const isRequest = requestPatterns.some(pattern => pattern.test(trimmed));
        
        // Verificar si es una conversación casual (mejorado)
        const casualPatterns = [
            /^(?:hola|buenos días|buenas tardes|buenas noches|hey|saludos|qué tal|adiós|hasta luego|nos vemos|gracias|ok|vale|bien|entiendo|comprendo|perfecto)\b/i,
            /^(?:genial|excelente|fantástico|maravilloso|estupendo|increíble|guay|chévere|qué bueno|qué bien|me alegro|me alegra)\b/i,
            /^(?:ja|jaja|jajaja|lol|jeje|jejeje|jiji|jijiji)/i  // Risas
        ];
        
        const isCasual = casualPatterns.some(pattern => pattern.test(trimmed));
        
        // Determinar tipo de estructura
        let type = 'statement'; // Por defecto es una declaración
        
        if (isQuestion) type = 'question';
        else if (isCommand) type = 'command';
        else if (isRequest) type = 'request';
        else if (isCasual) type = 'casual';
        
        // Analizar complejidad (mejorado)
        const wordCount = message.split(/\s+/).length;
        const sentenceCount = message.split(/[.!?;:]+/).filter(s => s.trim().length > 0).length;
        const longWordCount = message.split(/\s+/).filter(word => word.length > 6).length;
        
        let complexity = 'simple';
        
        // Algoritmo mejorado para determinar complejidad
        if (wordCount > 30 || sentenceCount > 3 || (longWordCount > 5 && wordCount > 15)) {
            complexity = 'complex';
        } else if (wordCount > 15 || sentenceCount > 1 || (longWordCount > 2 && wordCount > 10)) {
            complexity = 'moderate';
        }
        
        // Detectar oraciones subordinadas (indicador de complejidad)
        const subordinatePatterns = [
            /\b(?:aunque|mientras|cuando|porque|ya que|puesto que|dado que|si bien|a pesar de que|en caso de que|con tal de que|antes de que|después de que)\b/gi
        ];
        
        const subordinateCount = subordinatePatterns.reduce((count, pattern) => {
            return count + (message.match(pattern) || []).length;
        }, 0);
        
        if (subordinateCount > 1 && complexity === 'moderate') {
            complexity = 'complex';
        } else if (subordinateCount > 0 && complexity === 'simple') {
            complexity = 'moderate';
        }
        
        // Detectar código o fragmentos técnicos
        const codePatterns = [
            /\b(?:function|var|const|let|if|else|for|while|return|class|import|export|try|catch)\b/,
            /[a-zA-Z]+\([^)]*\)/,  // Llamadas a funciones
            /\{[^}]*\}/,          // Bloques de código
            /\[[^\]]*\]/,         // Arrays
            /</                    // Posible HTML o XML
        ];
        
        const containsCode = codePatterns.some(pattern => pattern.test(message));
        
        return {
            type,
            isQuestion,
            isCommand,
            isRequest,
            isCasual,
            complexity,
            wordCount,
            sentenceCount,
            longWordCount,
            subordinateCount,
            containsCode
        };
    } catch (error) {
        console.error('ContextAnalyzer: Error al analizar estructura del mensaje:', error);
        return { type: 'unknown', isQuestion: false };
    }
}

/**
 * Categoriza el tipo de pregunta
 * @param {string} question - Pregunta a categorizar
 * @returns {Object} Categoría de la pregunta
 * @private
 */
function categorizeQuestion(question) {
    try {
        if (!question || question.trim() === '') {
            return { type: 'other', confidence: 0.3 };
        }
        
        const lowerQuestion = question.toLowerCase();
        
        // Categorías de preguntas
        const categories = [
            {
                type: 'factual',
                patterns: [
                    /^(?:qué|cuál) es\b/i,
                    /^(?:quién|quiénes) (?:fue|fueron|es|son)\b/i,
                    /^(?:cuándo|dónde) (?:fue|es|ocurrió|sucedió|nació|comenzó|empezó|terminó|acabó)\b/i,
                    /^(?:cuánto|cuántos|cuántas)\b/i
                ],
                confidence: 0.85
            },
            {
                type: 'explanation',
                patterns: [
                    /^(?:por qué|cómo|de qué manera|de qué modo|de qué forma)\b/i,
                    /^(?:explica|explícame|puedes explicar|podrías explicar|me puedes explicar|me podrías explicar)/i,
                    /\b(?:funciona|ocurre|sucede|pasa|causa|efecto|razón|motivo|mecanismo)\b/i
                ],
                confidence: 0.8
            },
            {
                type: 'procedural',
                patterns: [
                    /^(?:cómo (?:puedo|podría|debo|se puede|hacer|realizar|llevar a cabo|implementar|ejecutar|lograr))\b/i,
                    /\b(?:pasos|proceso|procedimiento|método|forma|manera|técnica|protocolo) de\b/i,
                    /\b(?:instrucciones|guía|tutorial|ejemplo de|cómo se hace|cómo hacerlo)\b/i
                ],
                confidence: 0.85
            },
            {
                type: 'opinion',
                patterns: [
                    /^(?:qué (?:opinas|piensas|crees|consideras|te parece))\b/i,
                    /^(?:cuál es tu (?:opinión|punto de vista|perspectiva|postura|posición|valoración))\b/i,
                    /\b(?:estás de acuerdo|coincides|concuerdas|compartes la opinión|mejor|peor|preferible|recomendable)\b/i
                ],
                confidence: 0.75
            },
            {
                type: 'comparison',
                patterns: [
                    /^(?:qué|cuál) es (?:mejor|peor|más|menos)\b/i,
                    /\b(?:diferencia|similitud|semejanza|comparación|contraste) entre\b/i,
                    /\b(?:comparar|comparado|versus|vs|frente a|en comparación con)\b/i,
                    /\b(?:ventajas|desventajas|pros|contras|beneficios|perjuicios|fortalezas|debilidades)\b/i
                ],
                confidence: 0.85
            },
            {
                type: 'future',
                patterns: [
                    /\b(?:predic|pronóstico|futuro|proyección|tendencia|previsión|estimación|anticipación)\b/i,
                    /\b(?:ocurrirá|pasará|sucederá|será|estaremos|nos espera|vendrá|se avecina)\b/i,
                    /\b(?:próximos años|siguiente década|porvenir|perspectivas futuras|años venideros)\b/i
                ],
                confidence: 0.7
            },
            {
                type: 'recommendation',
                patterns: [
                    /\b(?:recomiendas|recomendarías|sugieres|sugerirías|aconsejas|aconsejarías)\b/i,
                    /\b(?:debería|convendría|mejor opción|buena idea|vale la pena|merece la pena)\b/i,
                    /\b(?:qué me recomiendas|qué sugieres|qué aconsejas|qué opción|qué alternativa)\b/i
                ],
                confidence: 0.8
            },
            {
                type: 'hypothetical',
                patterns: [
                    /\b(?:qué pasaría|qué ocurriría|qué sucedería|cómo sería|si fuera|si fuese)\b/i,
                    /\b(?:imagina que|supongamos que|suponiendo que|en el caso de que|en caso de)\b/i,
                    /\b(?:escenario hipotético|situación hipotética|posibilidad teórica)\b/i
                ],
                confidence: 0.75
            },
            {
                type: 'clarification',
                patterns: [
                    /\b(?:qué quieres decir|a qué te refieres|qué significa|cómo debo entender)\b/i,
                    /\b(?:puedes aclarar|podrías aclarar|me puedes aclarar|aclararme)\b/i,
                    /\b(?:no entiendo|no comprendo|no me queda claro|estoy confundido|estoy confundida)\b/i
                ],
                confidence: 0.85
            }
        ];
        
        // Verificar cada categoría
        for (const category of categories) {
            for (const pattern of category.patterns) {
                if (pattern.test(lowerQuestion)) {
                    return {
                        type: category.type,
                        confidence: category.confidence
                    };
                }
            }
        }
        
        // Verificar si termina con interrogación pero no encaja en otras categorías
        if (question.trim().endsWith('?')) {
            return {
                type: 'general_question',
                confidence: 0.6
            };
        }
        
        // Categoría por defecto si no se detecta ninguna específica
        return {
            type: 'other',
            confidence: 0.5
        };
    } catch (error) {
        console.error('ContextAnalyzer: Error al categorizar pregunta:', error);
        return { type: 'other', confidence: 0.3 };
    }
}

/**
 * Guarda el mapa de contexto para una conversación
 * @param {string} conversationId - ID de la conversación
 * @param {Object} contextMap - Mapa de contexto a guardar
 * @returns {Promise<void>}
 * @private
 */
async function saveContextMap(conversationId, contextMap) {
    try {
        if (!conversationId || !contextMap) {
            return;
        }
       
        const contextFile = path.join(CONTEXTS_DIR, `${conversationId}.json`);
        await fs.promises.writeFile(contextFile, JSON.stringify(contextMap, null, 2), 'utf8');
    } catch (error) {
        console.error(`ContextAnalyzer: Error al guardar contexto para ${conversationId}:`, error);
    }
}

/**
 * Obtiene estadísticas del analizador de contexto
 * @returns {Promise<Object>} Estadísticas del analizador
 */
async function getContextAnalyzerStats() {
    try {
        // Contar archivos de contexto de manera asíncrona
        let contextCount = 0;
        if (fs.existsSync(CONTEXTS_DIR)) {
            const files = await fs.promises.readdir(CONTEXTS_DIR);
            contextCount = files.filter(f => f.endsWith('.json')).length;
        }
        
        return {
            cache: {
                entries: analysisCache.size,
                hits: cacheStats.hits,
                misses: cacheStats.misses,
                hitRate: cacheStats.hits + cacheStats.misses > 0 
                    ? (cacheStats.hits / (cacheStats.hits + cacheStats.misses)).toFixed(2)
                    : 0
            },
            contexts: {
                count: contextCount
            },
            system: {
                memory: process.memoryUsage()
            }
        };
    } catch (error) {
        console.error('ContextAnalyzer: Error al obtener estadísticas:', error);
        return { error: error.message };
    }
}

// Inicializar el módulo
init();

module.exports = {
    analyzeMessage,
    updateAfterResponse,
    getContextAnalyzerStats
};
