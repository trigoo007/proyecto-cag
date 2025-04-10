/**
 * Sistema de Memoria Global para CAG (Optimizado)
 * 
 * Este módulo maneja la memoria compartida entre conversaciones, permitiendo
 * que el sistema aprenda y recuerde información relevante a lo largo del tiempo.
 * 
 * Versión mejorada con:
 * - Persistencia en MongoDB para mayor escalabilidad
 * - Caché LRU con políticas sofisticadas de expiración
 * - Procesamiento paralelo para tareas de mantenimiento
 * - Relevancia semántica basada en embeddings
 * - Gestión de contexto basada en coherencia temática
 * - Operaciones asíncronas estandarizadas
 * - Sistema de métricas y diagnóstico
 * - Categorización de memoria por nivel de sensibilidad
 * - Sistema de retroalimentación
 * - Normalización de datos para optimización
 */

const path = require('path');
const { Worker } = require('worker_threads');
const { MongoClient } = require('mongodb');
const LRUCache = require('lru-cache');
const entityExtractor = require('./entity-extractor');
const semanticService = require('./semantic-service');  // Servicio para embeddings y relevancia semántica

// Configuración de MongoDB
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017';
const DB_NAME = 'cag';
const COLLECTION_NAME = 'global_memory';

// Directorio para almacenamiento de backups locales
const DATA_DIR = path.join(__dirname, 'data');
const GLOBAL_MEMORY_DIR = path.join(DATA_DIR, 'global_memory');

// Configuración de memoria global
const MAX_GLOBAL_ENTITIES = 200;    // Máximo de entidades a almacenar
const MAX_GLOBAL_TOPICS = 50;       // Máximo de temas a almacenar
const MIN_ENTITY_OCCURRENCES = 2;   // Mínimas ocurrencias para considerar una entidad relevante
const GLOBAL_MEMORY_DECAY = 0.98;   // Factor de decaimiento por tiempo

// Niveles de sensibilidad para entidades
const SENSITIVITY_LEVELS = {
    PUBLIC: 'public',      // Información que puede compartirse libremente
    RESTRICTED: 'restricted', // Información que debe limitarse a ciertos contextos
    SENSITIVE: 'sensitive'   // Información sensible con acceso restringido
};

// Implementación de LRU Cache sofisticada
const memoryCache = new LRUCache({
    max: 10,                  // Número máximo de elementos en caché
    ttl: 5 * 60 * 1000,       // TTL predeterminado (5 minutos)
    updateAgeOnGet: true,     // Actualizar "edad" al consultar
    fetchMethod: async (key) => {
        // Método para cargar automáticamente valores faltantes
        if (key === 'global_memory') {
            return await getGlobalMemoryFromDB();
        }
        return null;
    }
});

// Cliente MongoDB
let mongoClient = null;

/**
 * Obtiene o crea una conexión al cliente MongoDB
 * @returns {Promise<MongoClient>} Cliente MongoDB
 */
async function getMongoClient() {
    if (!mongoClient) {
        mongoClient = new MongoClient(MONGO_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true
        });
        await mongoClient.connect();
        console.log('GlobalMemory: Conexión MongoDB establecida');
    }
    return mongoClient;
}

/**
 * Inicializa el sistema de memoria global
 * @returns {Promise<void>}
 */
async function init() {
    try {
        const fs = require('fs').promises;
        
        // Crear directorio para backups si no existe
        try {
            await fs.mkdir(GLOBAL_MEMORY_DIR, { recursive: true });
            console.log('GlobalMemory: Directorio de backups creado');
        } catch (dirError) {
            console.error('GlobalMemory: Error al crear directorio de backups:', dirError);
        }
        
        // Inicializar conexión a MongoDB
        const client = await getMongoClient();
        const db = client.db(DB_NAME);
        
        // Verificar si la colección existe
        const collections = await db.listCollections({ name: COLLECTION_NAME }).toArray();
        
        if (collections.length === 0) {
            // Crear colección e índices si no existe
            await db.createCollection(COLLECTION_NAME);
            
            // Crear índices para optimizar consultas
            await db.collection(COLLECTION_NAME).createIndex({ type: 1 });
            await db.collection(COLLECTION_NAME).createIndex({ "entities.name": 1 });
            await db.collection(COLLECTION_NAME).createIndex({ "topics.name": 1 });
            
            // Crear documento inicial
            const initialMemory = {
                type: 'global_memory',
                entities: [],
                topics: [],
                domainKnowledge: {},
                lastUpdated: new Date(),
                stats: {
                    totalUpdates: 0,
                    totalConversations: 0
                }
            };
            
            await db.collection(COLLECTION_NAME).insertOne(initialMemory);
            console.log('GlobalMemory: Documento de memoria global creado en MongoDB');
        }
        
        console.log('GlobalMemory: Sistema inicializado correctamente');
        
        // Programar mantenimiento periódico
        scheduleMaintenanceTasks();
        
        // Crear índices para métricas
        await db.collection('memory_metrics').createIndex({ timestamp: 1 });
        await db.collection('memory_metrics').createIndex({ entityType: 1 });
        
    } catch (error) {
        console.error('GlobalMemory: Error de inicialización:', error);
    }
}

/**
 * Obtiene el contexto de memoria global desde MongoDB
 * @returns {Promise<Object>} Contexto de memoria global
 * @private
 */
async function getGlobalMemoryFromDB() {
    try {
        const client = await getMongoClient();
        const db = client.db(DB_NAME);
        const collection = db.collection(COLLECTION_NAME);
        
        // Buscar documento de memoria global
        const memoryContext = await collection.findOne({ type: 'global_memory' });
        
        if (!memoryContext) {
            console.warn('GlobalMemory: Documento de memoria global no encontrado, inicializando');
            
            // Crear documento inicial
            const initialMemory = {
                type: 'global_memory',
                entities: [],
                topics: [],
                domainKnowledge: {},
                lastUpdated: new Date(),
                stats: {
                    totalUpdates: 0,
                    totalConversations: 0
                }
            };
            
            await collection.insertOne(initialMemory);
            return initialMemory;
        }
        
        return memoryContext;
    } catch (error) {
        console.error('GlobalMemory: Error al obtener contexto de memoria global desde MongoDB:', error);
        return {
            entities: [],
            topics: [],
            domainKnowledge: {},
            error: error.message
        };
    }
}

/**
 * Obtiene el contexto de memoria global
 * @returns {Promise<Object>} Contexto de memoria global
 */
async function getGlobalMemoryContext() {
    try {
        // Intentar obtener de caché
        const cachedMemory = await memoryCache.get('global_memory');
        if (cachedMemory) {
            return cachedMemory;
        }
        
        // Si no está en caché, obtener de BD
        const memoryContext = await getGlobalMemoryFromDB();
        
        // Actualizar caché con política adaptativa basada en uso
        const ttl = calculateDynamicTTL(memoryContext);
        await memoryCache.set('global_memory', memoryContext, { ttl });
        
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
 * Calcula un TTL dinámico basado en patrones de uso
 * @param {Object} memoryContext - Contexto de memoria global
 * @returns {number} TTL en milisegundos
 * @private
 */
function calculateDynamicTTL(memoryContext) {
    // Base TTL: 5 minutos
    const baseTTL = 5 * 60 * 1000;
    
    // Si hay muchas actualizaciones recientes, reducir TTL para mantener caché fresco
    if (memoryContext.stats && memoryContext.stats.updatesLast24h > 100) {
        return baseTTL / 2;
    }
    
    // Si hay pocas actualizaciones, aumentar TTL para reducir carga en BD
    if (memoryContext.stats && memoryContext.stats.updatesLast24h < 10) {
        return baseTTL * 2;
    }
    
    return baseTTL;
}

/**
 * Enriquece un mapa de contexto con la memoria global
 * @param {Object} contextMap - Mapa de contexto a enriquecer
 * @param {Object} options - Opciones para el enriquecimiento
 * @param {string} options.conversationId - ID de la conversación
 * @param {Array<string>} options.currentTopics - Temas actuales en la conversación
 * @returns {Promise<Object>} Contexto enriquecido con memoria global
 */
async function enrichContextWithGlobalMemory(contextMap, options = {}) {
    try {
        if (!contextMap) return {};
        
        // Crear copia para no modificar el original
        const enrichedContext = { ...contextMap };
        
        // Obtener memoria global
        const globalMemory = await getGlobalMemoryContext();
        
        // Añadir al contexto
        enrichedContext.globalMemory = {
            entities: [],
            topics: []
        };
        
        // Determinar temas actuales
        const currentTopics = options.currentTopics || [];
        if (contextMap.topics && Array.isArray(contextMap.topics)) {
            contextMap.topics.forEach(topic => {
                if (!currentTopics.includes(topic.name.toLowerCase())) {
                    currentTopics.push(topic.name.toLowerCase());
                }
            });
        }
        
        // Filtrar entidades relevantes (que no estén ya en el contexto)
        if (globalMemory.entities && globalMemory.entities.length > 0) {
            // Obtener nombres de entidades ya en el contexto
            const existingEntityNames = new Set();
            if (contextMap.entities && Array.isArray(contextMap.entities)) {
                contextMap.entities.forEach(entity => {
                    existingEntityNames.add(entity.name.toLowerCase());
                });
            }
            
            // Filtrar entidades relevantes usando coherencia temática y relevancia
            let relevantEntities = await filterRelevantEntities(
                globalMemory.entities,
                existingEntityNames,
                currentTopics,
                options
            );
            
            // Aplicar filtros de sensibilidad según contexto
            relevantEntities = filterBySensitivityLevel(relevantEntities, options);
            
            enrichedContext.globalMemory.entities = relevantEntities;
        }
        
        // Incluir temas relevantes
        if (globalMemory.topics && globalMemory.topics.length > 0) {
            // Obtener nombres de temas ya en el contexto
            const existingTopicNames = new Set(currentTopics);
            
            // Filtrar temas globales semánticamente relacionados
            const relevantTopics = await filterRelevantTopics(
                globalMemory.topics,
                existingTopicNames,
                options
            );
            
            enrichedContext.globalMemory.topics = relevantTopics;
        }
        
        // Incluir conocimiento de dominio relevante
        if (globalMemory.domainKnowledge) {
            // Filtrar solo conocimiento de dominio relevante al contexto actual
            const relevantKnowledge = {};
            
            for (const domain in globalMemory.domainKnowledge) {
                if (currentTopics.some(topic => 
                    domain.toLowerCase().includes(topic) || 
                    topic.includes(domain.toLowerCase())
                )) {
                    relevantKnowledge[domain] = globalMemory.domainKnowledge[domain];
                }
            }
            
            enrichedContext.globalMemory.domainKnowledge = relevantKnowledge;
        }
        
        // Registrar uso de la memoria global para métricas
        trackMemoryUsage('context_enrichment', {
            conversationId: options.conversationId || 'unknown',
            entitiesCount: enrichedContext.globalMemory.entities.length,
            topicsCount: enrichedContext.globalMemory.topics.length
        });
        
        return enrichedContext;
    } catch (error) {
        console.error('GlobalMemory: Error al enriquecer contexto:', error);
        return contextMap || {};
    }
}

/**
 * Filtra entidades por nivel de sensibilidad
 * @param {Array<Object>} entities - Lista de entidades
 * @param {Object} options - Opciones de contexto
 * @returns {Array<Object>} Entidades filtradas por sensibilidad
 * @private
 */
function filterBySensitivityLevel(entities, options = {}) {
    // Determinar nivel de acceso máximo según contexto
    // Por defecto solo permitir PUBLIC
    let maxLevel = SENSITIVITY_LEVELS.PUBLIC;
    
    // Si hay una autorización específica, permitir más acceso
    if (options.authorizedAccessLevel === SENSITIVITY_LEVELS.SENSITIVE) {
        maxLevel = SENSITIVITY_LEVELS.SENSITIVE;
    } else if (options.authorizedAccessLevel === SENSITIVITY_LEVELS.RESTRICTED) {
        maxLevel = SENSITIVITY_LEVELS.RESTRICTED;
    }
    
    // Filtrar entidades por nivel de sensibilidad
    return entities.filter(entity => {
        const sensitivityLevel = entity.sensitivityLevel || SENSITIVITY_LEVELS.PUBLIC;
        
        if (sensitivityLevel === SENSITIVITY_LEVELS.PUBLIC) {
            return true; // Siempre incluir públicas
        }
        
        if (sensitivityLevel === SENSITIVITY_LEVELS.RESTRICTED && 
            (maxLevel === SENSITIVITY_LEVELS.RESTRICTED || maxLevel === SENSITIVITY_LEVELS.SENSITIVE)) {
            return true;
        }
        
        if (sensitivityLevel === SENSITIVITY_LEVELS.SENSITIVE && 
            maxLevel === SENSITIVITY_LEVELS.SENSITIVE) {
            return true;
        }
        
        return false;
    });
}

/**
 * Filtra entidades relevantes usando técnicas semánticas
 * @param {Array<Object>} entities - Lista de entidades global
 * @param {Set<string>} existingEntityNames - Nombres de entidades ya en contexto
 * @param {Array<string>} currentTopics - Temas actuales
 * @param {Object} options - Opciones adicionales
 * @returns {Promise<Array<Object>>} Entidades relevantes filtradas
 * @private
 */
async function filterRelevantEntities(entities, existingEntityNames, currentTopics, options = {}) {
    try {
        // Filtrar entidades que no estén ya en el contexto
        let candidateEntities = entities.filter(entity => 
            !existingEntityNames.has(entity.name.toLowerCase())
        );
        
        // Si hay opciones de embedding o temas, calcular relevancia semántica
        if (currentTopics.length > 0 || options.contextEmbedding) {
            // Calcular relevancia semántica para cada entidad
            for (let i = 0; i < candidateEntities.length; i++) {
                const entity = candidateEntities[i];
                const semanticRelevance = await calculateSemanticRelevance(
                    entity, 
                    currentTopics, 
                    options.contextEmbedding
                );
                
                // Combinar relevancia semántica con factores temporales
                const temporalFactor = calculateTemporalDecay(entity.lastSeen);
                entity.relevanceScore = (temporalFactor * 0.4) + (semanticRelevance * 0.6);
            }
            
            // Ordenar por relevancia combinada
            candidateEntities.sort((a, b) => b.relevanceScore - a.relevanceScore);
        } else {
            // Si no hay datos para relevancia semántica, usar solo factores tradicionales
            candidateEntities.sort((a, b) => {
                const scoreA = (a.occurrences || 1) * (a.confidence || 0.5);
                const scoreB = (b.occurrences || 1) * (b.confidence || 0.5);
                return scoreB - scoreA;
            });
        }
        
        // Limitar cantidad para no sobrecargar el contexto
        return candidateEntities.slice(0, 10);
    } catch (error) {
        console.error('GlobalMemory: Error al filtrar entidades relevantes:', error);
        // En caso de error, usar método tradicional
        return entities
            .filter(entity => !existingEntityNames.has(entity.name.toLowerCase()))
            .sort((a, b) => {
                const scoreA = (a.occurrences || 1) * (a.confidence || 0.5);
                const scoreB = (b.occurrences || 1) * (b.confidence || 0.5);
                return scoreB - scoreA;
            })
            .slice(0, 10);
    }
}

/**
 * Filtra temas relevantes usando técnicas semánticas
 * @param {Array<Object>} topics - Lista de temas global
 * @param {Set<string>} existingTopicNames - Nombres de temas ya en contexto
 * @param {Object} options - Opciones adicionales
 * @returns {Promise<Array<Object>>} Temas relevantes filtrados
 * @private
 */
async function filterRelevantTopics(topics, existingTopicNames, options = {}) {
    try {
        // Filtrar temas que no estén ya en el contexto
        let candidateTopics = topics.filter(topic => 
            !existingTopicNames.has(topic.name.toLowerCase())
        );
        
        // Si hay opciones de embedding, calcular relevancia semántica
        if (options.contextEmbedding) {
            // Calcular relevancia semántica para cada tema
            for (let i = 0; i < candidateTopics.length; i++) {
                const topic = candidateTopics[i];
                const semanticRelevance = await semanticService.calculateTopicRelevance(
                    topic.name,
                    options.contextEmbedding
                );
                
                // Combinar relevancia semántica con factores tradicionales
                const temporalFactor = calculateTemporalDecay(topic.lastSeen);
                topic.relevanceScore = (temporalFactor * 0.3) + (semanticRelevance * 0.7);
            }
            
            // Ordenar por relevancia combinada
            candidateTopics.sort((a, b) => b.relevanceScore - a.relevanceScore);
        } else {
            // Si no hay datos para relevancia semántica, usar factores tradicionales
            candidateTopics.sort((a, b) => {
                const scoreA = (a.occurrences || 1) * (a.confidence || 0.5);
                const scoreB = (b.occurrences || 1) * (b.confidence || 0.5);
                return scoreB - scoreA;
            });
        }
        
        // Limitar cantidad para no sobrecargar el contexto
        return candidateTopics.slice(0, 5);
    } catch (error) {
        console.error('GlobalMemory: Error al filtrar temas relevantes:', error);
        // En caso de error, usar método tradicional
        return topics
            .filter(topic => !existingTopicNames.has(topic.name.toLowerCase()))
            .sort((a, b) => b.confidence - a.confidence)
            .slice(0, 5);
    }
}

/**
 * Calcula el factor de decaimiento temporal
 * @param {string} lastSeenDate - Fecha de última aparición
 * @returns {number} Factor de decaimiento (0-1)
 * @private
 */
function calculateTemporalDecay(lastSeenDate) {
    if (!lastSeenDate) return 0.5;
    
    const now = new Date();
    const lastSeen = new Date(lastSeenDate);
    const daysSinceLastSeen = (now - lastSeen) / (1000 * 60 * 60 * 24);
    
    // Decaimiento exponencial, más pronunciado después de una semana
    if (daysSinceLastSeen <= 7) {
        return 1.0; // Sin decaimiento en la primera semana
    } else {
        return Math.pow(GLOBAL_MEMORY_DECAY, (daysSinceLastSeen - 7) / 7);
    }
}

/**
 * Calcula la relevancia semántica de una entidad respecto al contexto actual
 * @param {Object} entity - Entidad a evaluar
 * @param {Array<string>} currentTopics - Temas actuales en la conversación
 * @param {Object} contextEmbedding - Embedding del contexto actual
 * @returns {Promise<number>} Puntuación de relevancia semántica (0-1)
 * @private
 */
async function calculateSemanticRelevance(entity, currentTopics = [], contextEmbedding = null) {
    try {
        // Si no hay embedding de contexto ni temas, generar uno a partir de la entidad
        if (!contextEmbedding && currentTopics.length === 0) {
            return 0.5; // Valor predeterminado
        }
        
        // Si hay un embedding de contexto, usarlo directamente
        if (contextEmbedding) {
            // Verificar si la entidad ya tiene un embedding, en caso contrario calcularlo
            if (!entity.embedding) {
                entity.embedding = await semanticService.generateEmbedding(
                    entity.name + ' ' + (entity.description || '')
                );
            }
            
            return await semanticService.calculateSimilarity(
                entity.embedding,
                contextEmbedding
            );
        }
        
        // Si no hay embedding pero hay temas, calcular relevancia basada en temas
        if (currentTopics.length > 0) {
            // Combinar temas para generar un embedding
            const topicsText = currentTopics.join(' ');
            const topicsEmbedding = await semanticService.generateEmbedding(topicsText);
            
            // Verificar si la entidad ya tiene un embedding, en caso contrario calcularlo
            if (!entity.embedding) {
                entity.embedding = await semanticService.generateEmbedding(
                    entity.name + ' ' + (entity.description || '')
                );
            }
            
            return await semanticService.calculateSimilarity(
                entity.embedding,
                topicsEmbedding
            );
        }
        
        return 0.5; // Valor predeterminado
    } catch (error) {
        console.error('GlobalMemory: Error al calcular relevancia semántica:', error);
        return 0.5; // Valor predeterminado en caso de error
    }
}

/**
 * Actualiza la memoria global con nueva información
 * @param {Object} contextMap - Mapa de contexto actual
 * @param {string} userMessage - Mensaje del usuario
 * @param {string} botResponse - Respuesta del bot
 * @param {string} conversationId - ID de la conversación
 * @param {Object} options - Opciones adicionales
 * @returns {Promise<boolean>} True si se actualizó correctamente
 */
async function updateGlobalMemory(contextMap, userMessage, botResponse, conversationId, options = {}) {
    try {
        if (!contextMap || !userMessage || !botResponse) {
            return false;
        }
        
        // Obtener memoria global actual
        const globalMemory = await getGlobalMemoryContext();
        
        // 1. Actualizar entidades
        await updateGlobalEntities(globalMemory, contextMap, userMessage, botResponse, options);
        
        // 2. Actualizar temas
        await updateGlobalTopics(globalMemory, contextMap, options);
        
        // 3. Actualizar estadísticas
        updateGlobalStats(globalMemory, conversationId);
        
        // 4. Actualizar timestamp
        globalMemory.lastUpdated = new Date();
        
        // 5. Actualizar contador de actualizaciones recientes (para TTL dinámico)
        globalMemory.stats.updatesLast24h = (globalMemory.stats.updatesLast24h || 0) + 1;
        
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
 * @param {Object} options - Opciones adicionales
 * @private
 */
async function updateGlobalEntities(globalMemory, contextMap, userMessage, botResponse, options = {}) {
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
        
        // Normalizar entidades para reducir redundancia
        newEntities = normalizeEntities(newEntities);
        
        // Calcular embeddings para entidades nuevas (procesamiento en lotes)
        const entitiesToEmbed = newEntities.filter(entity => !entity.embedding);
        if (entitiesToEmbed.length > 0) {
            const embeddings = await semanticService.batchGenerateEmbeddings(
                entitiesToEmbed.map(entity => entity.name + ' ' + (entity.description || ''))
            );
            
            for (let i = 0; i < entitiesToEmbed.length; i++) {
                entitiesToEmbed[i].embedding = embeddings[i];
            }
        }
        
        // Actualizar entidades existentes o añadir nuevas
        for (const newEntity of newEntities) {
            // Validar entidad
            if (!newEntity.name || !newEntity.type) continue;
            
            // Determinar nivel de sensibilidad (predeterminado: público)
            if (!newEntity.sensitivityLevel) {
                newEntity.sensitivityLevel = determineSensitivityLevel(newEntity, options);
            }
            
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
                    lastSeen: new Date(),
                    // Conservar o actualizar descripción
                    description: newEntity.description || existingEntity.description,
                    // Conservar embedding si existe o usar el nuevo
                    embedding: existingEntity.embedding || newEntity.embedding,
                    // Mantener nivel de sensibilidad más restrictivo
                    sensitivityLevel: getMostRestrictiveSensitivity(
                        existingEntity.sensitivityLevel, 
                        newEntity.sensitivityLevel
                    )
                };
            } else {
                // Añadir nueva entidad
                globalMemory.entities.push({
                    name: newEntity.name,
                    type: newEntity.type,
                    confidence: newEntity.confidence || 0.5,
                    description: newEntity.description || null,
                    embedding: newEntity.embedding || null,
                    occurrences: 1,
                    firstSeen: new Date(),
                    lastSeen: new Date(),
                    sensitivityLevel: newEntity.sensitivityLevel || SENSITIVITY_LEVELS.PUBLIC
                });
            }
        }
        
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
 * Normaliza entidades para reducir redundancia
 * @param {Array<Object>} entities - Lista de entidades
 * @returns {Array<Object>} Lista de entidades normalizada
 * @private
 */
function normalizeEntities(entities) {
    // Detectar duplicados con nombres muy similares
    const normalizedEntities = [];
    const processedNames = new Set();
    
    for (const entity of entities) {
        // Normalizar nombre para comparación
        const normalizedName = entity.name.toLowerCase().trim();
        
        // Saltar si ya procesamos una entidad muy similar
        if (processedNames.has(normalizedName)) {
            continue;
        }
        
        // Marcar como procesada
        processedNames.add(normalizedName);
        normalizedEntities.push(entity);
    }
    
    return normalizedEntities;
}

/**
 * Determina el nivel de sensibilidad para una entidad
 * @param {Object} entity - Entidad a evaluar
 * @param {Object} options - Opciones de contexto
 * @returns {string} Nivel de sensibilidad
 * @private
 */
function determineSensitivityLevel(entity, options = {}) {
    // Lista de palabras clave que indican información sensible
    const sensitiveKeywords = ['password', 'secret', 'private', 'confidential', 'personal'];
    const restrictedKeywords = ['internal', 'restricted', 'limited'];
    
    // Texto para analizar
    const textToAnalyze = (entity.name + ' ' + (entity.description || '')).toLowerCase();
    
    // Verificar si contiene palabras clave sensibles
    if (sensitiveKeywords.some(keyword => textToAnalyze.includes(keyword))) {
        return SENSITIVITY_LEVELS.SENSITIVE;
    }
    
    // Verificar si contiene palabras clave restringidas
    if (restrictedKeywords.some(keyword => textToAnalyze.includes(keyword))) {
        return SENSITIVITY_LEVELS.RESTRICTED;
    }
    
    // Verificar si el tipo de entidad es inherentemente sensible
    if (entity.type === 'PERSON' || entity.type === 'CONTACT' || entity.type === 'PASSWORD') {
        return SENSITIVITY_LEVELS.SENSITIVE;
    }
    
    // Si hay una clasificación explícita en opciones, usarla
    if (options.entitySensitivity && options.entitySensitivity[entity.name]) {
        return options.entitySensitivity[entity.name];
    }
    
    // Por defecto, considerar pública
    return SENSITIVITY_LEVELS.PUBLIC;
}

/**
 * Devuelve el nivel de sensibilidad más restrictivo entre dos
 * @param {string} level1 - Primer nivel de sensibilidad
 * @param {string} level2 - Segundo nivel de sensibilidad
 * @returns {string} Nivel más restrictivo
 * @private
 */
function getMostRestrictiveSensitivity(level1, level2) {
    const levels = [level1 || SENSITIVITY_LEVELS.PUBLIC, level2 || SENSITIVITY_LEVELS.PUBLIC];
    
    if (levels.includes(SENSITIVITY_LEVELS.SENSITIVE)) {
        return SENSITIVITY_LEVELS.SENSITIVE;
    }
    
    if (levels.includes(SENSITIVITY_LEVELS.RESTRICTED)) {
        return SENSITIVITY_LEVELS.RESTRICTED;
    }
    
    return SENSITIVITY_LEVELS.PUBLIC;
}

/**
 * Actualiza temas en la memoria global
 * @param {Object} globalMemory - Memoria global
 * @param {Object} contextMap - Mapa de contexto actual
 * @param {Object} options - Opciones adicionales
 * @private
 */
async function updateGlobalTopics(globalMemory, contextMap, options = {}) {
    try {
        // Inicializar si no existe
        if (!globalMemory.topics) {
            globalMemory.topics = [];
        }
        
        // Si no hay temas en el contexto, terminar
        if (!contextMap.topics || !Array.isArray(contextMap.topics) || contextMap.topics.length === 0) {
            return;
        }
        
        // Normalizar temas para reducir redundancia
        const normalizedTopics = normalizeTopics(contextMap.topics);
        
        // Calcular embeddings para temas nuevos
        const topicsToEmbed = normalizedTopics.filter(topic => !topic.embedding);
        if (topicsToEmbed.length > 0) {
            const embeddings = await semanticService.batchGenerateEmbeddings(
                topicsToEmbed.map(topic => topic.name)
            );
            
            for (let i = 0; i < topicsToEmbed.length; i++) {
                topicsToEmbed[i].embedding = embeddings[i];
            }
        }
        
        // Actualizar temas existentes o añadir nuevos
        for (const newTopic of normalizedTopics) {
            // Validar tema
            if (!newTopic.name) continue;
            
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
                    lastSeen: new Date(),
                    // Conservar embedding si existe o usar el nuevo
                    embedding: existingTopic.embedding || newTopic.embedding
                };
            } else {
                // Añadir nuevo tema
                globalMemory.topics.push({
                    name: newTopic.name,
                    confidence: newTopic.confidence || 0.5,
                    embedding: newTopic.embedding || null,
                    occurrences: 1,
                    firstSeen: new Date(),
                    lastSeen: new Date()
                });
            }
        }
        
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
 * Normaliza temas para reducir redundancia
 * @param {Array<Object>} topics - Lista de temas
 * @returns {Array<Object>} Lista de temas normalizada
 * @private
 */
function normalizeTopics(topics) {
    const normalizedTopics = [];
    const processedNames = new Set();
    
    for (const topic of topics) {
        // Normalizar nombre para comparación
        const normalizedName = topic.name.toLowerCase().trim();
        
        // Saltar si ya procesamos un tema muy similar
        if (processedNames.has(normalizedName)) {
            continue;
        }
        
        // Marcar como procesado
        processedNames.add(normalizedName);
        normalizedTopics.push(topic);
    }
    
    return normalizedTopics;
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
                conversationIds: [],
                updatesLast24h: 0
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
        
        // Actualizar contador de actualizaciones recientes
        // Esto es útil para el cálculo de TTL dinámico de caché
        globalMemory.stats.updatesLast24h = (globalMemory.stats.updatesLast24h || 0) + 1;
    } catch (error) {
        console.error('GlobalMemory: Error al actualizar estadísticas globales:', error);
    }
}

/**
 * Guarda la memoria global en MongoDB
 * @param {Object} globalMemory - Memoria global a guardar
 * @returns {Promise<boolean>} True si se guardó correctamente
 * @private
 */
async function saveGlobalMemory(globalMemory) {
    try {
        const client = await getMongoClient();
        const db = client.db(DB_NAME);
        const collection = db.collection(COLLECTION_NAME);
        
        // Actualizar documento existente o crear uno nuevo
        await collection.updateOne(
            { type: 'global_memory' },
            { $set: globalMemory },
            { upsert: true }
        );
        
        // Actualizar caché con nueva memoria
        await memoryCache.set('global_memory', globalMemory);
        
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
    // Ejecutar mantenimiento cada 12 horas usando worker threads
    setInterval(() => {
        try {
            console.log('GlobalMemory: Iniciando worker de mantenimiento programado');
            
            const worker = new Worker('./maintenance_worker.js');
            
            worker.on('message', (result) => {
                console.log('GlobalMemory: Mantenimiento completado con resultado:', result);
                // Invalidar caché para que se refresque con los nuevos datos
                memoryCache.delete('global_memory');
            });
            
            worker.on('error', (error) => {
                console.error('GlobalMemory: Error en worker de mantenimiento:', error);
            });
            
            worker.on('exit', (code) => {
                if (code !== 0) {
                    console.error(`GlobalMemory: Worker de mantenimiento finalizó con código ${code}`);
                }
            });
        } catch (error) {
            console.error('GlobalMemory: Error al iniciar mantenimiento programado:', error);
            // Si falla el worker, intentar mantenimiento directo
            performMaintenance().catch(err => {
                console.error('GlobalMemory: Error en mantenimiento de respaldo:', err);
            });
        }
    }, 12 * 60 * 60 * 1000); // 12 horas
    
    // Limpiar métricas cada 30 días
    setInterval(async () => {
        try {
            await cleanupOldMetrics();
        } catch (error) {
            console.error('GlobalMemory: Error al limpiar métricas antiguas:', error);
        }
    }, 30 * 24 * 60 * 60 * 1000); // 30 días
}

/**
 * Realiza tareas de mantenimiento en la memoria global
 * @returns {Promise<boolean>} True si el mantenimiento se realizó correctamente
 */
async function performMaintenance() {
    try {
        // Obtener memoria global
        const globalMemory = await getGlobalMemoryContext();
        
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
        
        // Reiniciar contador de actualizaciones recientes (usado para TTL dinámico)
        globalMemory.stats.updatesLast24h = 0;
        
        // Actualizar timestamp de mantenimiento
        globalMemory.lastMaintenance = new Date();
        
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
 * Registra métricas de uso de la memoria global
 * @param {string} operationType - Tipo de operación
 * @param {Object} details - Detalles de la operación
 * @private
 */
async function trackMemoryUsage(operationType, details = {}) {
    try {
        const client = await getMongoClient();
        const db = client.db(DB_NAME);
        const collection = db.collection('memory_metrics');
        
        const metric = {
            timestamp: new Date(),
            operationType,
            details,
            wasHelpful: details.wasHelpful || null
        };
        
        await collection.insertOne(metric);
        
        // Actualizar estadísticas agregadas
        if (details.entityType && details.wasHelpful !== undefined) {
            await updateEntityTypeMetrics(details.entityType, details.wasHelpful);
        }
    } catch (error) {
        console.error('GlobalMemory: Error al registrar métricas de uso:', error);
    }
}

/**
 * Actualiza métricas agregadas por tipo de entidad
 * @param {string} entityType - Tipo de entidad
 * @param {boolean} wasHelpful - Si la entidad fue útil
 * @private
 */
async function updateEntityTypeMetrics(entityType, wasHelpful) {
    try {
        const client = await getMongoClient();
        const db = client.db(DB_NAME);
        const collection = db.collection('entity_type_metrics');
        
        // Actualizar métricas para este tipo de entidad
        await collection.updateOne(
            { entityType },
            {
                $inc: {
                    totalUses: 1,
                    helpfulUses: wasHelpful ? 1 : 0
                }
            },
            { upsert: true }
        );
    } catch (error) {
        console.error('GlobalMemory: Error al actualizar métricas por tipo de entidad:', error);
    }
}

/**
 * Limpia métricas antiguas para optimizar espacio
 * @private
 */
async function cleanupOldMetrics() {
    try {
        const client = await getMongoClient();
        const db = client.db(DB_NAME);
        const collection = db.collection('memory_metrics');
        
        // Eliminar métricas más antiguas que 90 días
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - 90);
        
        await collection.deleteMany({
            timestamp: { $lt: cutoffDate }
        });
        
        console.log('GlobalMemory: Métricas antiguas eliminadas');
    } catch (error) {
        console.error('GlobalMemory: Error al limpiar métricas antiguas:', error);
    }
}

/**
 * Reinicia la memoria global a un estado inicial
 * @returns {Promise<Object>} Resultado de la operación
 */
async function resetGlobalMemory() {
    try {
        const fs = require('fs').promises;
        
        // Crear backup antes de reiniciar
        const client = await getMongoClient();
        const db = client.db(DB_NAME);
        const collection = db.collection(COLLECTION_NAME);
        
        // Obtener memoria actual para hacer backup
        const currentMemory = await collection.findOne({ type: 'global_memory' });
        
        if (currentMemory) {
            // Crear directorio de backups si no existe
            const backupDir = path.join(GLOBAL_MEMORY_DIR, 'backups');
            try {
                await fs.mkdir(backupDir, { recursive: true });
            } catch (dirError) {
                console.error('GlobalMemory: Error al crear directorio de backups:', dirError);
            }
            
            // Nombre del archivo de backup con timestamp
            const timestamp = new Date().toISOString().replace(/:/g, '-');
            const backupPath = path.join(backupDir, `memory_backup_${timestamp}.json`);
            
            // Guardar backup en disco
            await fs.writeFile(
                backupPath, 
                JSON.stringify(currentMemory, null, 2), 
                'utf8'
            );
            
            // También guardar backup en MongoDB
            await db.collection('memory_backups').insertOne({
                originalMemory: currentMemory,
                timestamp: new Date(),
                reason: 'manual_reset'
            });
        }
        
        // Crear nueva memoria global vacía
        const newMemory = {
            type: 'global_memory',
            entities: [],
            topics: [],
            domainKnowledge: {},
            lastUpdated: new Date(),
            stats: {
                totalUpdates: 0,
                totalConversations: 0,
                updatesLast24h: 0,
                reset: {
                    timestamp: new Date(),
                    reason: 'manual_reset'
                }
            }
        };
        
        // Guardar nueva memoria
        await collection.updateOne(
            { type: 'global_memory' },
            { $set: newMemory },
            { upsert: true }
        );
        
        // Actualizar caché
        await memoryCache.set('global_memory', newMemory);
        
        return {
            success: true,
            message: 'Memoria global reiniciada correctamente',
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
 * Proporciona feedback sobre una entidad de memoria global
 * @param {string} entityName - Nombre de la entidad
 * @param {string} entityType - Tipo de entidad
 * @param {Object} feedback - Información de retroalimentación
 * @param {boolean} feedback.isCorrect - Si la información es correcta
 * @param {string} feedback.correctedDescription - Descripción corregida (opcional)
 * @param {number} feedback.correctedConfidence - Confianza corregida (opcional)
 * @param {string} feedback.userComment - Comentario del usuario (opcional)
 * @returns {Promise<Object>} Resultado de la operación
 */
async function provideFeedback(entityName, entityType, feedback) {
    try {
        if (!entityName || !entityType) {
            return {
                success: false,
                error: 'Nombre y tipo de entidad son requeridos'
            };
        }
        
        // Obtener memoria global
        const globalMemory = await getGlobalMemoryContext();
        
        // Buscar la entidad
        const entityIndex = globalMemory.entities.findIndex(
            entity => entity.name.toLowerCase() === entityName.toLowerCase() && 
                     entity.type === entityType
        );
        
        if (entityIndex === -1) {
            return {
                success: false,
                error: 'Entidad no encontrada'
            };
        }
        
        // Guardar estado anterior para registro
        const previousEntityState = { ...globalMemory.entities[entityIndex] };
        
        // Aplicar cambios según feedback
        if (feedback.isCorrect === false) {
            // Si se marcó como incorrecta
            if (feedback.correctedDescription) {
                globalMemory.entities[entityIndex].description = feedback.correctedDescription;
            }
            
            if (feedback.correctedConfidence !== undefined) {
                globalMemory.entities[entityIndex].confidence = feedback.correctedConfidence;
            } else {
                // Reducir confianza si se marcó como incorrecta sin valor específico
                globalMemory.entities[entityIndex].confidence *= 0.7;
            }
        } else {
            // Si se marcó como correcta, aumentar confianza
            globalMemory.entities[entityIndex].confidence = Math.min(
                1.0,
                (globalMemory.entities[entityIndex].confidence || 0.5) * 1.2
            );
        }
        
        // Registrar feedback
        const feedbackRecord = {
            entityName,
            entityType,
            previousState: previousEntityState,
            newState: globalMemory.entities[entityIndex],
            feedback,
            timestamp: new Date()
        };
        
        // Guardar registro de feedback
        const client = await getMongoClient();
        const db = client.db(DB_NAME);
        await db.collection('memory_feedback').insertOne(feedbackRecord);
        
        // Actualizar métricas
        await trackMemoryUsage('feedback', {
            entityType,
            wasHelpful: feedback.isCorrect,
            feedbackDetails: feedback
        });
        
        // Guardar cambios en memoria global
        await saveGlobalMemory(globalMemory);
        
        return {
            success: true,
            message: 'Feedback registrado correctamente',
            entity: globalMemory.entities[entityIndex]
        };
    } catch (error) {
        console.error('GlobalMemory: Error al proporcionar feedback:', error);
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

/**
 * Obtiene estadísticas sobre la memoria global
 * @returns {Promise<Object>} Estadísticas de la memoria global
 */
async function getGlobalMemoryStats() {
    try {
        const globalMemory = await getGlobalMemoryContext();
        
        // Recopilar estadísticas básicas
        const stats = {
            lastUpdated: globalMemory.lastUpdated,
            lastMaintenance: globalMemory.lastMaintenance || null,
            entitiesCount: globalMemory.entities ? globalMemory.entities.length : 0,
            topicsCount: globalMemory.topics ? globalMemory.topics.length : 0,
            totalUpdates: globalMemory.stats ? globalMemory.stats.totalUpdates : 0,
            totalConversations: globalMemory.stats ? globalMemory.stats.totalConversations : 0,
            
            // Estadísticas por tipo de entidad
            entitiesByType: {},
            
            // Estadísticas por nivel de sensibilidad
            entitiesBySensitivity: {
                [SENSITIVITY_LEVELS.PUBLIC]: 0,
                [SENSITIVITY_LEVELS.RESTRICTED]: 0,
                [SENSITIVITY_LEVELS.SENSITIVE]: 0
            }
        };
        
        // Contar entidades por tipo y nivel de sensibilidad
        if (globalMemory.entities && globalMemory.entities.length > 0) {
            globalMemory.entities.forEach(entity => {
                // Contar por tipo
                if (!stats.entitiesByType[entity.type]) {
                    stats.entitiesByType[entity.type] = 0;
                }
                stats.entitiesByType[entity.type]++;
                
                // Contar por nivel de sensibilidad
                const sensitivityLevel = entity.sensitivityLevel || SENSITIVITY_LEVELS.PUBLIC;
                stats.entitiesBySensitivity[sensitivityLevel]++;
            });
        }
        
        // Obtener estadísticas de uso de métricas
        const client = await getMongoClient();
        const db = client.db(DB_NAME);
        
        // Estadísticas de uso por tipo de entidad
        const entityTypeMetrics = await db.collection('entity_type_metrics').find().toArray();
        stats.entityTypeMetrics = entityTypeMetrics;
        
        // Estadísticas de operaciones recientes
        const recentOperations = await db.collection('memory_metrics')
            .find()
            .sort({ timestamp: -1 })
            .limit(100)
            .toArray();
        
        stats.recentOperations = recentOperations;
        
        return stats;
    } catch (error) {
        console.error('GlobalMemory: Error al obtener estadísticas:', error);
        return {
            error: error.message
        };
    }
}

// Inicializar el módulo
init().catch(error => {
    console.error('GlobalMemory: Error en inicialización:', error);
});

// Exportar funciones públicas
module.exports = {
    getGlobalMemoryContext,
    enrichContextWithGlobalMemory,
    updateGlobalMemory,
    performMaintenance,
    resetGlobalMemory,
    provideFeedback,
    getGlobalMemoryStats,
    SENSITIVITY_LEVELS
};
