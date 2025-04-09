/**
 * Gestor de Contexto para CAG
 * 
 * Este módulo coordina el almacenamiento, recuperación y gestión del contexto
 * para las conversaciones, actuando como intermediario entre los distintos
 * componentes del sistema.
 */

const fs = require('fs');
const path = require('path');
const contextAnalyzer = require('./context-analyzer');
const entityExtractor = require('./entity-extractor');
const memoryStore = require('./memory-store');
const documentProcessor = require('./document-processor');
const globalMemory = require('./global-memory');

// Directorio para almacenamiento de datos
const DATA_DIR = path.join(__dirname, 'data');
const CONTEXTS_DIR = path.join(DATA_DIR, 'contexts');

// Caché en memoria para contextos activos
const activeContexts = new Map();
// TTL para contextos en caché (10 minutos)
const CONTEXT_CACHE_TTL = 10 * 60 * 1000;

/**
 * Inicializa el gestor de contexto
 */
function init() {
    try {
        // Crear directorio de contextos si no existe
        if (!fs.existsSync(CONTEXTS_DIR)) {
            fs.mkdirSync(CONTEXTS_DIR, { recursive: true });
            console.log('ContextManager: Directorio de contextos creado');
        }
        
        console.log('ContextManager: Inicializado correctamente');
        
        // Programar limpieza periódica de caché
        setInterval(cleanupContextCache, CONTEXT_CACHE_TTL);
    } catch (error) {
        console.error('ContextManager: Error de inicialización:', error);
    }
}

/**
 * Obtiene el contexto para una conversación
 * @param {string} conversationId - ID de la conversación
 * @param {string} userId - ID del usuario (opcional)
 * @returns {Object} Mapa de contexto
 */
function getContextMap(conversationId, userId = null) {
    try {
        if (!conversationId) {
            console.warn('ContextManager: ID de conversación faltante');
            return {};
        }
        
        // Verificar si está en caché
        const cacheKey = `${conversationId}:${userId || 'anonymous'}`;
        if (activeContexts.has(cacheKey)) {
            const cachedContext = activeContexts.get(cacheKey);
            
            // Verificar si el contexto no ha expirado
            if (Date.now() - cachedContext.lastAccessed < CONTEXT_CACHE_TTL) {
                // Actualizar timestamp de último acceso
                cachedContext.lastAccessed = Date.now();
                activeContexts.set(cacheKey, cachedContext);
                
                return cachedContext.contextMap;
            }
        }
        
        // Si no está en caché o expiró, cargar desde disco
        const contextPath = path.join(CONTEXTS_DIR, `${conversationId}.json`);
        
        if (fs.existsSync(contextPath)) {
            try {
                const contextData = fs.readFileSync(contextPath, 'utf8');
                const contextMap = JSON.parse(contextData);
                
                // Guardar en caché
                activeContexts.set(cacheKey, {
                    contextMap,
                    lastAccessed: Date.now()
                });
                
                return contextMap;
            } catch (readError) {
                console.error(`ContextManager: Error al leer contexto para ${conversationId}:`, readError);
            }
        }
        
        // Si no existe, devolver objeto vacío
        return {};
    } catch (error) {
        console.error(`ContextManager: Error al obtener contexto para ${conversationId}:`, error);
        return {};
    }
}

/**
 * Actualiza el contexto de una conversación
 * @param {string} conversationId - ID de la conversación
 * @param {string} userId - ID del usuario (opcional)
 * @param {Object} contextMap - Nuevo mapa de contexto
 * @returns {boolean} True si se actualizó correctamente
 */
function updateContextMap(conversationId, userId, contextMap) {
    try {
        if (!conversationId || !contextMap) {
            console.warn('ContextManager: ID de conversación o mapa de contexto faltante');
            return false;
        }
        
        // Actualizar timestamp
        contextMap.lastUpdated = new Date().toISOString();
        
        // Guardar a disco
        const contextPath = path.join(CONTEXTS_DIR, `${conversationId}.json`);
        fs.writeFileSync(contextPath, JSON.stringify(contextMap, null, 2), 'utf8');
        
        // Actualizar caché
        const cacheKey = `${conversationId}:${userId || 'anonymous'}`;
        activeContexts.set(cacheKey, {
            contextMap,
            lastAccessed: Date.now()
        });
        
        return true;
    } catch (error) {
        console.error(`ContextManager: Error al actualizar contexto para ${conversationId}:`, error);
        return false;
    }
}

/**
 * Enriquece un contexto con información adicional
 * @param {string} conversationId - ID de la conversación
 * @param {Object} contextMap - Mapa de contexto a enriquecer
 * @returns {Promise<Object>} Contexto enriquecido
 */
async function enrichContext(conversationId, contextMap) {
    try {
        if (!contextMap) return {};
        
        let enrichedContext = { ...contextMap };
        
        // Añadir ID de conversación
        enrichedContext.currentConversationId = conversationId;
        
        // Enriquecer con información de documentos
        try {
            const documents = await documentProcessor.getConversationDocuments(conversationId);
            
            if (documents && documents.length > 0) {
                enrichedContext.documents = documents.map(doc => ({
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
            console.error('ContextManager: Error al procesar documentos:', docError);
        }
        
        // Enriquecer con memoria global
        try {
            enrichedContext = globalMemory.enrichContextWithGlobalMemory(enrichedContext);
        } catch (globalMemoryError) {
            console.error('ContextManager: Error al enriquecer con memoria global:', globalMemoryError);
        }
        
        return enrichedContext;
    } catch (error) {
        console.error(`ContextManager: Error al enriquecer contexto para ${conversationId}:`, error);
        return contextMap || {};
    }
}

/**
 * Analiza un mensaje y actualiza el contexto
 * @param {string} conversationId - ID de la conversación
 * @param {string} userId - ID del usuario (opcional)
 * @param {string} message - Mensaje a analizar
 * @returns {Promise<Object>} Contexto actualizado
 */
async function processMessage(conversationId, userId, message) {
    try {
        if (!conversationId || !message) {
            console.warn('ContextManager: ID de conversación o mensaje faltante');
            return {};
        }
        
        // Analizar mensaje con el analizador de contexto
        const contextMap = await contextAnalyzer.analyzeMessage(
            conversationId,
            userId,
            message
        );
        
        // Enriquecer contexto con información adicional
        const enrichedContext = await enrichContext(conversationId, contextMap);
        
        // Guardar contexto enriquecido
        updateContextMap(conversationId, userId, enrichedContext);
        
        return enrichedContext;
    } catch (error) {
        console.error(`ContextManager: Error al procesar mensaje para ${conversationId}:`, error);
        return {};
    }
}

/**
 * Actualiza el contexto después de una respuesta
 * @param {string} conversationId - ID de la conversación
 * @param {string} userId - ID del usuario (opcional)
 * @param {Object} contextMap - Mapa de contexto actual
 * @param {string} userMessage - Mensaje del usuario
 * @param {string} botResponse - Respuesta del bot
 * @returns {Promise<Object>} Contexto actualizado
 */
async function processResponse(conversationId, userId, contextMap, userMessage, botResponse) {
    try {
        if (!conversationId || !contextMap) {
            console.warn('ContextManager: ID de conversación o contexto faltante');
            return contextMap || {};
        }
        
        // Actualizar el contexto con la respuesta
        const updatedContext = await contextAnalyzer.updateAfterResponse(
            conversationId,
            userId,
            contextMap,
            userMessage,
            botResponse
        );
        
        // Actualizar memoria global
        try {
            await globalMemory.updateGlobalMemory(
                contextMap,
                userMessage,
                botResponse,
                conversationId
            );
        } catch (globalMemoryError) {
            console.error('ContextManager: Error al actualizar memoria global:', globalMemoryError);
        }
        
        // Guardar contexto actualizado
        updateContextMap(conversationId, userId, updatedContext);
        
        return updatedContext;
    } catch (error) {
        console.error(`ContextManager: Error al procesar respuesta para ${conversationId}:`, error);
        return contextMap || {};
    }
}

/**
 * Busca contexto relevante para una consulta
 * @param {string} conversationId - ID de la conversación
 * @param {string} query - Consulta para buscar
 * @returns {Promise<Object>} Resultados relevantes
 */
async function searchContext(conversationId, query) {
    try {
        if (!conversationId || !query) {
            return { entities: [], memory: [], documents: [] };
        }
        
        // Buscar entidades relevantes
        const entities = await entityExtractor.searchEntities(query);
        
        // Buscar en memoria
        const memoryItems = await memoryStore.searchMemory(conversationId, query);
        
        // Buscar en documentos
        const documents = await documentProcessor.searchDocuments(conversationId, query);
        
        return {
            entities,
            memory: memoryItems,
            documents
        };
    } catch (error) {
        console.error(`ContextManager: Error al buscar contexto para ${conversationId}:`, error);
        return { entities: [], memory: [], documents: [] };
    }
}

/**
 * Limpia la caché de contextos inactivos
 * @private
 */
function cleanupContextCache() {
    try {
        const now = Date.now();
        let cleaned = 0;
        
        for (const [key, value] of activeContexts.entries()) {
            if (now - value.lastAccessed > CONTEXT_CACHE_TTL) {
                activeContexts.delete(key);
                cleaned++;
            }
        }
        
        if (cleaned > 0) {
            console.log(`ContextManager: Limpiados ${cleaned} contextos inactivos de la caché`);
        }
    } catch (error) {
        console.error('ContextManager: Error al limpiar caché de contextos:', error);
    }
}

/**
 * Elimina el contexto de una conversación
 * @param {string} conversationId - ID de la conversación
 * @returns {boolean} True si se eliminó correctamente
 */
function deleteContext(conversationId) {
    try {
        if (!conversationId) {
            return false;
        }
        
        const contextPath = path.join(CONTEXTS_DIR, `${conversationId}.json`);
        
        // Eliminar de disco si existe
        if (fs.existsSync(contextPath)) {
            fs.unlinkSync(contextPath);
        }
        
        // Eliminar de caché
        for (const key of activeContexts.keys()) {
            if (key.startsWith(`${conversationId}:`)) {
                activeContexts.delete(key);
            }
        }
        
        return true;
    } catch (error) {
        console.error(`ContextManager: Error al eliminar contexto para ${conversationId}:`, error);
        return false;
    }
}

/**
 * Obtiene estadísticas sobre los contextos almacenados
 * @returns {Object} Estadísticas de contexto
 */
function getContextStats() {
    try {
        if (!fs.existsSync(CONTEXTS_DIR)) {
            return {
                totalContexts: 0,
                activeContextsCount: 0,
                averageSize: 0
            };
        }
        
        const files = fs.readdirSync(CONTEXTS_DIR)
            .filter(file => file.endsWith('.json'));
        
        let totalSize = 0;
        
        files.forEach(file => {
            try {
                const filePath = path.join(CONTEXTS_DIR, file);
                const stats = fs.statSync(filePath);
                totalSize += stats.size;
            } catch (err) {
                // Ignorar archivos con error
            }
        });
        
        const averageSize = files.length > 0 ? Math.round(totalSize / files.length) : 0;
        
        return {
            totalContexts: files.length,
            activeContextsCount: activeContexts.size,
            averageSize
        };
    } catch (error) {
        console.error('ContextManager: Error al obtener estadísticas de contexto:', error);
        return {
            totalContexts: 0,
            activeContextsCount: 0,
            averageSize: 0,
            error: error.message
        };
    }
}

// Inicializar el módulo
init();

module.exports = {
    getContextMap,
    updateContextMap,
    enrichContext,
    processMessage,
    processResponse,
    searchContext,
    deleteContext,
    getContextStats
};