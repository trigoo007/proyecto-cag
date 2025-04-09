/**
 * Sistema de Memoria Global para CAG
 * 
 * Este módulo maneja la memoria compartida entre conversaciones, permitiendo
 * que el sistema aprenda y recuerde información relevante a lo largo del tiempo.
 */

const fs = require('fs');
const path = require('path');
const entityExtractor = require('./entity-extractor');

// Directorio para almacenamiento de memoria global
const DATA_DIR = path.join(__dirname, 'data');
const GLOBAL_MEMORY_DIR = path.join(DATA_DIR, 'global_memory');
const GLOBAL_MEMORY_FILE = path.join(GLOBAL_MEMORY_DIR, 'memory.json');

// Configuración de memoria global
const MAX_GLOBAL_ENTITIES = 200;    // Máximo de entidades a almacenar
const MAX_GLOBAL_TOPICS = 50;       // Máximo de temas a almacenar
const MIN_ENTITY_OCCURRENCES = 2;   // Mínimas ocurrencias para considerar una entidad relevante
const GLOBAL_MEMORY_DECAY = 0.98;   // Factor de decaimiento por tiempo (más lento que la memoria personal)

// Caché en memoria
let globalMemoryCache = null;
let lastCacheUpdate = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutos

/**
 * Inicializa el sistema de memoria global
 */
function init() {
    try {
        // Crear directorio si no existe
        if (!fs.existsSync(GLOBAL_MEMORY_DIR)) {
            fs.mkdirSync(GLOBAL_MEMORY_DIR, { recursive: true });
            console.log('GlobalMemory: Directorio de memoria global creado');
        }
        
        // Crear archivo inicial si no existe
        if (!fs.existsSync(GLOBAL_MEMORY_FILE)) {
            const initialMemory = {
                entities: [],
                topics: [],
                domainKnowledge: {},
                lastUpdated: new Date().toISOString(),
                stats: {
                    totalUpdates: 0,
                    totalConversations: 0
                }
            };
            
            fs.writeFileSync(GLOBAL_MEMORY_FILE, JSON.stringify(initialMemory, null, 2), 'utf8');
            console.log('GlobalMemory: Archivo de memoria global creado');
        }
        
        console.log('GlobalMemory: Sistema inicializado correctamente');
        
        // Programar mantenimiento periódico
        scheduleMaintenanceTasks();
    } catch (error) {
        console.error('GlobalMemory: Error de inicialización:', error);
    }
}

/**
 * Obtiene el contexto de memoria global
 * @returns {Object} Contexto de memoria global
 */
function getGlobalMemoryContext() {
    try {
        // Utilizar caché si está disponible y no ha expirado
        if (globalMemoryCache && (Date.now() - lastCacheUpdate) < CACHE_TTL) {
            return globalMemoryCache;
        }
        
        if (!fs.existsSync(GLOBAL_MEMORY_FILE)) {
            console.warn('GlobalMemory: Archivo de memoria global no encontrado, inicializando');
            init();
            return {
                entities: [],
                topics: [],
                domainKnowledge: {}
            };
        }
        
        const data = fs.readFileSync(GLOBAL_MEMORY_FILE, 'utf8');
        const memoryContext = JSON.parse(data);
        
        // Actualizar caché
        globalMemoryCache = memoryContext;
        lastCacheUpdate = Date.now();
        
        return memoryContext;
    } catch (error) {
        console.error('GlobalMemory: Error al obtener contexto de memoria global:', error);
        return {
            entities: [],
            topics: [],
            domainKnowledge: {},
            error: error.message
        };
    }
}

/**
 * Enriquece un mapa de contexto con la memoria global
 * @param {Object} contextMap - Mapa de contexto a enriquecer
 * @returns {Object} Contexto enriquecido con memoria global
 */
function enrichContextWithGlobalMemory(contextMap) {
    try {
        if (!contextMap) return {};
        
        // Crear copia para no modificar el original
        const enrichedContext = { ...contextMap };
        
        // Obtener memoria global
        const globalMemory = getGlobalMemoryContext();
        
        // Añadir al contexto
        enrichedContext.globalMemory = {
            entities: [],
            topics: []
        };
        
        // Filtrar entidades relevantes (que no estén ya en el contexto)
        if (globalMemory.entities && globalMemory.entities.length > 0) {
            // Obtener nombres de entidades ya en el contexto
            const existingEntityNames = new Set();
            if (contextMap.entities && Array.isArray(contextMap.entities)) {
                contextMap.entities.forEach(entity => {
                    existingEntityNames.add(entity.name.toLowerCase());
                });
            }
            
            // Filtrar entidades globales que no estén ya en el contexto
            const relevantEntities = globalMemory.entities
                .filter(entity => !existingEntityNames.has(entity.name.toLowerCase()))
                .slice(0, 10); // Limitar cantidad para no sobrecargar el contexto
            
            enrichedContext.globalMemory.entities = relevantEntities;
        }
        
        // Incluir temas relevantes
        if (globalMemory.topics && globalMemory.topics.length > 0) {
            // Obtener nombres de temas ya en el contexto
            const existingTopicNames = new Set();
            if (contextMap.topics && Array.isArray(contextMap.topics)) {
                contextMap.topics.forEach(topic => {
                    existingTopicNames.add(topic.name.toLowerCase());
                });
            }
            
            // Filtrar temas globales que no estén ya en el contexto
            const relevantTopics = globalMemory.topics
                .filter(topic => !existingTopicNames.has(topic.name.toLowerCase()))
                .sort((a, b) => b.confidence - a.confidence)
                .slice(0, 5); // Limitar cantidad
            
            enrichedContext.globalMemory.topics = relevantTopics;
        }
        
        // Incluir conocimiento de dominio si es relevante
        if (globalMemory.domainKnowledge) {
            enrichedContext.globalMemory.domainKnowledge = globalMemory.domainKnowledge;
        }
        
        return enrichedContext;
    } catch (error) {
        console.error('GlobalMemory: Error al enriquecer contexto:', error);
        return contextMap || {};
    }
}

/**
 * Actualiza la memoria global con nueva información
 * @param {Object} contextMap - Mapa de contexto actual
 * @param {string} userMessage - Mensaje del usuario
 * @param {string} botResponse - Respuesta del bot
 * @param {string} conversationId - ID de la conversación
 * @returns {Promise<boolean>} True si se actualizó correctamente
 */
async function updateGlobalMemory(contextMap, userMessage, botResponse, conversationId) {
    try {
        if (!contextMap || !userMessage || !botResponse) {
            return false;
        }
        
        // Obtener memoria global actual
        const globalMemory = getGlobalMemoryContext();
        
        // 1. Actualizar entidades
        await updateGlobalEntities(globalMemory, contextMap, userMessage, botResponse);
        
        // 2. Actualizar temas
        updateGlobalTopics(globalMemory, contextMap);
        
        // 3. Actualizar estadísticas
        updateGlobalStats(globalMemory, conversationId);
        
        // 4. Actualizar timestamp
        globalMemory.lastUpdated = new Date().toISOString();
        
        // Guardar cambios
        await saveGlobalMemory(globalMemory);
        
        return true;
    } catch (error) {
        console.error('GlobalMemory: Error al actualizar memoria global:', error);
        return false;
    }
}

/**
 * Actualiza entidades en la memoria global
 * @param {Object} globalMemory - Memoria global
 * @param {Object} contextMap - Mapa de contexto actual
 * @param {string} userMessage - Mensaje del usuario
 * @param {string} botResponse - Respuesta del bot
 * @private
 */
async function updateGlobalEntities(globalMemory, contextMap, userMessage, botResponse) {
    try {
        // Inicializar si no existe
        if (!globalMemory.entities) {
            globalMemory.entities = [];
        }
        
        // Combinar entidades del contexto actual
        let newEntities = [];
        
        // Añadir entidades del contexto
        if (contextMap.entities && Array.isArray(contextMap.entities)) {
            newEntities = [...contextMap.entities];
        }
        
        // Extraer entidades adicionales de la respuesta del bot
        try {
            const extractedEntities = await entityExtractor.extractEntities(botResponse);
            if (extractedEntities && extractedEntities.length > 0) {
                newEntities = [...newEntities, ...extractedEntities];
            }
        } catch (extractError) {
            console.error('GlobalMemory: Error al extraer entidades adicionales:', extractError);
        }
        
        // Si no hay entidades nuevas, terminar
        if (newEntities.length === 0) {
            return;
        }
        
        // Actualizar entidades existentes o añadir nuevas
        newEntities.forEach(newEntity => {
            // Validar entidad
            if (!newEntity.name || !newEntity.type) return;
            
            // Buscar entidad existente
            const existingEntityIndex = globalMemory.entities.findIndex(
                entity => entity.name.toLowerCase() === newEntity.name.toLowerCase() && 
                          entity.type === newEntity.type
            );
            
            if (existingEntityIndex >= 0) {
                // Actualizar entidad existente
                const existingEntity = globalMemory.entities[existingEntityIndex];
                globalMemory.entities[existingEntityIndex] = {
                    ...existingEntity,
                    occurrences: (existingEntity.occurrences || 1) + 1,
                    confidence: Math.max(existingEntity.confidence || 0, newEntity.confidence || 0),
                    lastSeen: new Date().toISOString(),
                    // Conservar o actualizar descripción
                    description: newEntity.description || existingEntity.description
                };
            } else {
                // Añadir nueva entidad
                globalMemory.entities.push({
                    name: newEntity.name,
                    type: newEntity.type,
                    confidence: newEntity.confidence || 0.5,
                    description: newEntity.description || null,
                    occurrences: 1,
                    firstSeen: new Date().toISOString(),
                    lastSeen: new Date().toISOString()
                });
            }
        });
        
        // Ordenar por relevancia (ocurrencias * confianza)
        globalMemory.entities.sort((a, b) => {
            const scoreA = (a.occurrences || 1) * (a.confidence || 0.5);
            const scoreB = (b.occurrences || 1) * (b.confidence || 0.5);
            return scoreB - scoreA;
        });
        
        // Limitar tamaño de la lista de entidades
        if (globalMemory.entities.length > MAX_GLOBAL_ENTITIES) {
            globalMemory.entities = globalMemory.entities.slice(0, MAX_GLOBAL_ENTITIES);
        }
    } catch (error) {
        console.error('GlobalMemory: Error al actualizar entidades globales:', error);
    }
}

/**
 * Actualiza temas en la memoria global
 * @param {Object} globalMemory - Memoria global
 * @param {Object} contextMap - Mapa de contexto actual
 * @private
 */
function updateGlobalTopics(globalMemory, contextMap) {
    try {
        // Inicializar si no existe
        if (!globalMemory.topics) {
            globalMemory.topics = [];
        }
        
        // Si no hay temas en el contexto, terminar
        if (!contextMap.topics || !Array.isArray(contextMap.topics) || contextMap.topics.length === 0) {
            return;
        }
        
        // Actualizar temas existentes o añadir nuevos
        contextMap.topics.forEach(newTopic => {
            // Validar tema
            if (!newTopic.name) return;
            
            // Buscar tema existente
            const existingTopicIndex = globalMemory.topics.findIndex(
                topic => topic.name.toLowerCase() === newTopic.name.toLowerCase()
            );
            
            if (existingTopicIndex >= 0) {
                // Actualizar tema existente
                const existingTopic = globalMemory.topics[existingTopicIndex];
                globalMemory.topics[existingTopicIndex] = {
                    ...existingTopic,
                    occurrences: (existingTopic.occurrences || 1) + 1,
                    confidence: calculateRollingAverage(
                        existingTopic.confidence || 0.5,
                        newTopic.confidence || 0.5,
                        existingTopic.occurrences || 1
                    ),
                    lastSeen: new Date().toISOString()
                };
            } else {
                // Añadir nuevo tema
                globalMemory.topics.push({
                    name: newTopic.name,
                    confidence: newTopic.confidence || 0.5,
                    occurrences: 1,
                    firstSeen: new Date().toISOString(),
                    lastSeen: new Date().toISOString()
                });
            }
        });
        
        // Ordenar por relevancia (ocurrencias * confianza)
        globalMemory.topics.sort((a, b) => {
            const scoreA = (a.occurrences || 1) * (a.confidence || 0.5);
            const scoreB = (b.occurrences || 1) * (b.confidence || 0.5);
            return scoreB - scoreA;
        });
        
        // Limitar tamaño de la lista de temas
        if (globalMemory.topics.length > MAX_GLOBAL_TOPICS) {
            globalMemory.topics = globalMemory.topics.slice(0, MAX_GLOBAL_TOPICS);
        }
    } catch (error) {
        console.error('GlobalMemory: Error al actualizar temas globales:', error);
    }
}

/**
 * Actualiza estadísticas en la memoria global
 * @param {Object} globalMemory - Memoria global
 * @param {string} conversationId - ID de la conversación
 * @private
 */
function updateGlobalStats(globalMemory, conversationId) {
    try {
        // Inicializar si no existe
        if (!globalMemory.stats) {
            globalMemory.stats = {
                totalUpdates: 0,
                totalConversations: 0,
                conversationIds: []
            };
        }
        
        // Inicializar array de conversaciones si no existe
        if (!globalMemory.stats.conversationIds) {
            globalMemory.stats.conversationIds = [];
        }
        
        // Actualizar contadores
        globalMemory.stats.totalUpdates = (globalMemory.stats.totalUpdates || 0) + 1;
        
        // Registrar conversación si es nueva
        if (conversationId && !globalMemory.stats.conversationIds.includes(conversationId)) {
            globalMemory.stats.conversationIds.push(conversationId);
            globalMemory.stats.totalConversations = globalMemory.stats.conversationIds.length;
        }
    } catch (error) {
        console.error('GlobalMemory: Error al actualizar estadísticas globales:', error);
    }
}

/**
 * Guarda la memoria global en disco
 * @param {Object} globalMemory - Memoria global a guardar
 * @returns {Promise<boolean>} True si se guardó correctamente
 * @private
 */
async function saveGlobalMemory(globalMemory) {
    try {
        // Crear directorio si no existe
        if (!fs.existsSync(GLOBAL_MEMORY_DIR)) {
            fs.mkdirSync(GLOBAL_MEMORY_DIR, { recursive: true });
        }
        
        // Guardar a disco
        fs.writeFileSync(GLOBAL_MEMORY_FILE, JSON.stringify(globalMemory, null, 2), 'utf8');
        
        // Actualizar caché
        globalMemoryCache = globalMemory;
        lastCacheUpdate = Date.now();
        
        return true;
    } catch (error) {
        console.error('GlobalMemory: Error al guardar memoria global:', error);
        return false;
    }
}

/**
 * Programa tareas de mantenimiento periódicas
 * @private
 */
function scheduleMaintenanceTasks() {
    // Ejecutar mantenimiento cada 12 horas
    setInterval(async () => {
        try {
            console.log('GlobalMemory: Iniciando mantenimiento programado');
            await performMaintenance();
        } catch (error) {
            console.error('GlobalMemory: Error en mantenimiento programado:', error);
        }
    }, 12 * 60 * 60 * 1000); // 12 horas
}

/**
 * Realiza tareas de mantenimiento en la memoria global
 * @returns {Promise<boolean>} True si el mantenimiento se realizó correctamente
 * @private
 */
async function performMaintenance() {
    try {
        // Obtener memoria global
        const globalMemory = getGlobalMemoryContext();
        
        // Aplicar decaimiento temporal a entidades
        if (globalMemory.entities && globalMemory.entities.length > 0) {
            // Calcular tiempo actual
            const now = new Date();
            
            globalMemory.entities.forEach((entity, index) => {
                // Calcular días desde la última vez que se vio
                const lastSeen = new Date(entity.lastSeen || entity.firstSeen);
                const daysSinceLastSeen = (now - lastSeen) / (1000 * 60 * 60 * 24);
                
                // Aplicar decaimiento exponencial
                if (daysSinceLastSeen > 7) { // Solo aplicar después de una semana
                    const decayFactor = Math.pow(GLOBAL_MEMORY_DECAY, daysSinceLastSeen / 7);
                    globalMemory.entities[index].confidence *= decayFactor;
                }
            });
            
            // Eliminar entidades con confianza muy baja o pocas ocurrencias
            globalMemory.entities = globalMemory.entities.filter(entity => 
                entity.confidence > 0.1 && (entity.occurrences || 0) >= MIN_ENTITY_OCCURRENCES
            );
        }
        
        // Aplicar decaimiento a temas
        if (globalMemory.topics && globalMemory.topics.length > 0) {
            // Calcular tiempo actual
            const now = new Date();
            
            globalMemory.topics.forEach((topic, index) => {
                // Calcular días desde la última vez que se vio
                const lastSeen = new Date(topic.lastSeen || topic.firstSeen);
                const daysSinceLastSeen = (now - lastSeen) / (1000 * 60 * 60 * 24);
                
                // Aplicar decaimiento exponencial
                if (daysSinceLastSeen > 7) { // Solo aplicar después de una semana
                    const decayFactor = Math.pow(GLOBAL_MEMORY_DECAY, daysSinceLastSeen / 7);
                    globalMemory.topics[index].confidence *= decayFactor;
                }
            });
            
            // Eliminar temas con confianza muy baja
            globalMemory.topics = globalMemory.topics.filter(topic => 
                topic.confidence > 0.1
            );
        }
        
        // Limpiar estadísticas antiguas
        if (globalMemory.stats && globalMemory.stats.conversationIds) {
            // Limitar el número de IDs de conversación almacenados
            if (globalMemory.stats.conversationIds.length > 1000) {
                globalMemory.stats.conversationIds = globalMemory.stats.conversationIds.slice(-1000);
            }
        }
        
        // Actualizar timestamp de mantenimiento
        globalMemory.lastMaintenance = new Date().toISOString();
        
        // Guardar cambios
        await saveGlobalMemory(globalMemory);
        
        console.log('GlobalMemory: Mantenimiento completado');
        return true;
    } catch (error) {
        console.error('GlobalMemory: Error al realizar mantenimiento:', error);
        return false;
    }
}

/**
 * Reinicia la memoria global a un estado inicial
 * @returns {Promise<Object>} Resultado de la operación
 */
async function resetGlobalMemory() {
    try {
        // Crear backup antes de reiniciar
        const backupDir = path.join(GLOBAL_MEMORY_DIR, 'backups');
        fs.mkdirSync(backupDir, { recursive: true });
        
        // Nombre del archivo de backup con timestamp
        const timestamp = new Date().toISOString().replace(/:/g, '-');
        const backupPath = path.join(backupDir, `memory_backup_${timestamp}.json`);
        
        // Hacer backup si existe el archivo
        if (fs.existsSync(GLOBAL_MEMORY_FILE)) {
            fs.copyFileSync(GLOBAL_MEMORY_FILE, backupPath);
        }
        
        // Crear nueva memoria global vacía
        const newMemory = {
            entities: [],
            topics: [],
            domainKnowledge: {},
            lastUpdated: new Date().toISOString(),
            stats: {
                totalUpdates: 0,
                totalConversations: 0,
                reset: {
                    timestamp: new Date().toISOString(),
                    backupPath: backupPath
                }
            }
        };
        
        // Guardar nueva memoria
        fs.writeFileSync(GLOBAL_MEMORY_FILE, JSON.stringify(newMemory, null, 2), 'utf8');
        
        // Actualizar caché
        globalMemoryCache = newMemory;
        lastCacheUpdate = Date.now();
        
        return {
            success: true,
            message: 'Memoria global reiniciada correctamente',
            backupPath: backupPath,
            timestamp: new Date().toISOString()
        };
    } catch (error) {
        console.error('GlobalMemory: Error al reiniciar memoria global:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Calcula un promedio ponderado dando más peso a la nueva información
 * @param {number} oldValue - Valor anterior
 * @param {number} newValue - Nuevo valor
 * @param {number} occurrences - Ocurrencias anteriores
 * @returns {number} Promedio ponderado
 * @private
 */
function calculateRollingAverage(oldValue, newValue, occurrences) {
    // El peso del nuevo valor disminuye con más ocurrencias para estabilizar
    const newValueWeight = 1 / (occurrences + 1);
    const oldValueWeight = 1 - newValueWeight;
    
    return (oldValue * oldValueWeight) + (newValue * newValueWeight);
}

// Inicializar el módulo
init();

module.exports = {
    getGlobalMemoryContext,
    enrichContextWithGlobalMemory,
    updateGlobalMemory,
    performMaintenance,
    resetGlobalMemory
};