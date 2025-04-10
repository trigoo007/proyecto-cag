/**
 * Gestor de Contexto para CAG
 * 
 * Este módulo coordina el almacenamiento, recuperación y gestión del contexto
 * para las conversaciones, actuando como intermediario entre los distintos
 * componentes del sistema.
 */

const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const LRUCache = require('lru-cache');
const Joi = require('joi');
const pRetry = require('p-retry');
const { v4: uuidv4 } = require('uuid');
const contextAnalyzer = require('./context-analyzer');
const entityExtractor = require('./entity-extractor');
const memoryStore = require('./memory-store');
const documentProcessor = require('./document-processor');
const globalMemory = require('./global-memory');
const logger = require('./logger'); // Asumiendo que existe un módulo de logger estructurado

// Directorio para almacenamiento de datos
const DATA_DIR = path.join(__dirname, 'data');
const CONTEXTS_DIR = path.join(DATA_DIR, 'contexts');
const HISTORY_DIR = path.join(DATA_DIR, 'context-history');

// Configuración de caché LRU para contextos activos
const CONTEXT_CACHE_TTL = 10 * 60 * 1000; // 10 minutos
const MAX_CACHE_SIZE = 100; // Máximo número de contextos en caché
const activeContexts = new LRUCache({
  max: MAX_CACHE_SIZE,
  ttl: CONTEXT_CACHE_TTL,
  updateAgeOnGet: true // Actualizar "edad" al acceder
});

// Sistema de bloqueo para manejo de concurrencia
const contextLocks = new Map();

// Tamaño máximo para fragmentación de contextos (en bytes)
const MAX_CONTEXT_FRAGMENT_SIZE = 1024 * 100; // 100KB

// Esquema de validación para objetos de contexto
const contextMapSchema = Joi.object({
  lastUpdated: Joi.string().isoDate(),
  entities: Joi.array().items(Joi.object()).default([]),
  topics: Joi.array().items(Joi.string()).default([]),
  intents: Joi.array().items(Joi.string()).default([]),
  sentiments: Joi.object().default({}),
  documents: Joi.array().items(Joi.object()).default([]),
  // Otros campos que puedan ser necesarios...
}).unknown(true); // Permitir campos adicionales

/**
 * Inicializa el gestor de contexto
 * @returns {Promise<void>}
 */
async function init() {
  try {
    // Crear directorios si no existen
    if (!fsSync.existsSync(CONTEXTS_DIR)) {
      await fs.mkdir(CONTEXTS_DIR, { recursive: true });
      logger.info('ContextManager: Directorio de contextos creado');
    }
    
    if (!fsSync.existsSync(HISTORY_DIR)) {
      await fs.mkdir(HISTORY_DIR, { recursive: true });
      logger.info('ContextManager: Directorio de historial creado');
    }
    
    logger.info('ContextManager: Inicializado correctamente');
    
    // Programar limpieza periódica de bloqueos
    setInterval(cleanupLocks, CONTEXT_CACHE_TTL / 2);
  } catch (error) {
    logger.error('ContextManager: Error de inicialización:', { error: error.message, stack: error.stack });
    throw new Error(`Error inicializando ContextManager: ${error.message}`);
  }
}

/**
 * Adquiere un bloqueo para operaciones en un contexto específico
 * @param {string} conversationId - ID de la conversación
 * @param {number} timeout - Tiempo máximo de espera en ms (por defecto 3000ms)
 * @returns {Promise<string>} ID del bloqueo
 * @private
 */
async function acquireLock(conversationId, timeout = 3000) {
  const lockId = uuidv4();
  const startTime = Date.now();
  
  // Esperar hasta obtener el bloqueo o agotar el timeout
  while (Date.now() - startTime < timeout) {
    if (!contextLocks.has(conversationId)) {
      contextLocks.set(conversationId, {
        id: lockId,
        timestamp: Date.now()
      });
      logger.debug('ContextManager: Bloqueo adquirido', { conversationId, lockId });
      return lockId;
    }
    
    // Esperar 100ms antes de reintentar
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  throw new Error(`Timeout al adquirir bloqueo para conversación ${conversationId}`);
}

/**
 * Libera un bloqueo para operaciones en un contexto específico
 * @param {string} conversationId - ID de la conversación
 * @param {string} lockId - ID del bloqueo a liberar
 * @returns {boolean} True si se liberó correctamente
 * @private
 */
function releaseLock(conversationId, lockId) {
  if (!contextLocks.has(conversationId)) {
    return false;
  }
  
  const lock = contextLocks.get(conversationId);
  if (lock.id !== lockId) {
    logger.warn('ContextManager: Intento de liberar bloqueo no adquirido', { 
      conversationId, 
      attemptedLockId: lockId, 
      actualLockId: lock.id 
    });
    return false;
  }
  
  contextLocks.delete(conversationId);
  logger.debug('ContextManager: Bloqueo liberado', { conversationId, lockId });
  return true;
}

/**
 * Limpia bloqueos expirados
 * @private
 */
function cleanupLocks() {
  try {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [conversationId, lock] of contextLocks.entries()) {
      // Liberar bloqueos más antiguos que el TTL de la caché (posible bloqueo huérfano)
      if (now - lock.timestamp > CONTEXT_CACHE_TTL) {
        contextLocks.delete(conversationId);
        cleaned++;
        logger.warn('ContextManager: Bloqueo expirado liberado', { conversationId, lockId: lock.id });
      }
    }
    
    if (cleaned > 0) {
      logger.info(`ContextManager: Limpiados ${cleaned} bloqueos expirados`);
    }
  } catch (error) {
    logger.error('ContextManager: Error al limpiar bloqueos:', { error: error.message });
  }
}

/**
 * Guarda una versión del contexto en el historial
 * @param {string} conversationId - ID de la conversación 
 * @param {Object} contextMap - Contexto a guardar
 * @returns {Promise<string>} ID de la versión
 * @private
 */
async function saveContextHistory(conversationId, contextMap) {
  try {
    const versionId = uuidv4();
    const historyPath = path.join(HISTORY_DIR, `${conversationId}_${versionId}.json`);
    
    // Clonar el contextMap y añadir metadatos de versión
    const versionedContext = {
      ...contextMap,
      _versionId: versionId,
      _versionTimestamp: new Date().toISOString()
    };
    
    await fs.writeFile(historyPath, JSON.stringify(versionedContext, null, 2), 'utf8');
    return versionId;
  } catch (error) {
    logger.error('ContextManager: Error al guardar historial de contexto:', { 
      conversationId, 
      error: error.message 
    });
    return null;
  }
}

/**
 * Fragmenta un objeto de contexto grande en partes más pequeñas
 * @param {Object} contextMap - Objeto de contexto a fragmentar
 * @returns {Array<Object>} Array de fragmentos
 * @private
 */
function fragmentContext(contextMap) {
  const serialized = JSON.stringify(contextMap);
  
  // Si es menor que el tamaño máximo, no fragmentar
  if (Buffer.byteLength(serialized, 'utf8') <= MAX_CONTEXT_FRAGMENT_SIZE) {
    return [{ type: 'full', data: contextMap }];
  }
  
  // Estrategia simple: dividir grandes arreglos
  const fragments = [];
  
  // Datos base sin arrays grandes
  const baseContext = { ...contextMap };
  
  // Extraer y fragmentar arrays grandes
  for (const key of Object.keys(contextMap)) {
    if (Array.isArray(contextMap[key]) && contextMap[key].length > 10) {
      // Eliminar del contexto base
      delete baseContext[key];
      
      // Fragmentar el array
      const arr = contextMap[key];
      const chunkSize = 10;
      
      for (let i = 0; i < arr.length; i += chunkSize) {
        const chunk = arr.slice(i, i + chunkSize);
        fragments.push({
          type: 'fragment',
          key,
          index: i / chunkSize,
          data: chunk,
          total: Math.ceil(arr.length / chunkSize)
        });
      }
    }
  }
  
  // Añadir el contexto base al principio
  fragments.unshift({
    type: 'base',
    data: baseContext
  });
  
  logger.debug('ContextManager: Contexto fragmentado', { 
    totalFragments: fragments.length,
    keys: Object.keys(contextMap).filter(k => Array.isArray(contextMap[k]) && contextMap[k].length > 10)
  });
  
  return fragments;
}

/**
 * Reensambla un contexto a partir de sus fragmentos
 * @param {Array<Object>} fragments - Fragmentos del contexto
 * @returns {Object} Contexto reensamblado
 * @private
 */
function reassembleContext(fragments) {
  if (!fragments || fragments.length === 0) {
    return {};
  }
  
  // Si solo hay un fragmento y es completo
  if (fragments.length === 1 && fragments[0].type === 'full') {
    return fragments[0].data;
  }
  
  // Buscar el fragmento base
  const baseFragment = fragments.find(f => f.type === 'base');
  if (!baseFragment) {
    logger.error('ContextManager: No se encontró fragmento base al reensamblar contexto');
    return {};
  }
  
  // Clonar el contexto base
  const contextMap = { ...baseFragment.data };
  
  // Procesar fragmentos de arrays
  const arrayFragments = fragments.filter(f => f.type === 'fragment');
  
  // Agrupar por clave
  const fragmentsByKey = arrayFragments.reduce((acc, fragment) => {
    if (!acc[fragment.key]) {
      acc[fragment.key] = [];
    }
    acc[fragment.key].push(fragment);
    return acc;
  }, {});
  
  // Reensamblar cada array fragmentado
  for (const [key, fragments] of Object.entries(fragmentsByKey)) {
    // Ordenar por índice
    fragments.sort((a, b) => a.index - b.index);
    
    // Verificar que tenemos todos los fragmentos
    const totalExpected = fragments[0].total;
    if (fragments.length !== totalExpected) {
      logger.warn(`ContextManager: Faltan fragmentos para la clave ${key}`, {
        expected: totalExpected,
        found: fragments.length
      });
    }
    
    // Reensamblar el array
    contextMap[key] = fragments.flatMap(f => f.data);
  }
  
  return contextMap;
}

/**
 * Obtiene el contexto para una conversación
 * @param {string} conversationId - ID de la conversación
 * @param {string} userId - ID del usuario (opcional)
 * @param {Object} options - Opciones adicionales
 * @returns {Promise<Object>} Mapa de contexto
 */
async function getContextMap(conversationId, userId = null, options = {}) {
  try {
    if (!conversationId) {
      logger.warn('ContextManager: ID de conversación faltante');
      return {};
    }
    
    // Verificar si está en caché
    const cacheKey = `${conversationId}:${userId || 'anonymous'}`;
    if (activeContexts.has(cacheKey)) {
      const cachedContext = activeContexts.get(cacheKey);
      logger.debug('ContextManager: Contexto recuperado de caché', { conversationId, userId });
      return cachedContext;
    }
    
    // Si no está en caché, cargar desde disco con reintentos
    const contextPath = path.join(CONTEXTS_DIR, `${conversationId}.json`);
    const fragmentBasePath = path.join(CONTEXTS_DIR, `${conversationId}_fragment_`);
    
    // Comprobar si existe el archivo principal
    if (fsSync.existsSync(contextPath)) {
      try {
        // Usar pRetry para reintentar en caso de fallos
        const contextMap = await pRetry(async () => {
          const contextData = await fs.readFile(contextPath, 'utf8');
          
          let parsedData;
          try {
            parsedData = JSON.parse(contextData);
          } catch (parseError) {
            logger.error('ContextManager: Error al parsear JSON del contexto', {
              conversationId,
              error: parseError.message
            });
            throw new Error(`Error al parsear JSON: ${parseError.message}`);
          }
          
          // Comprobar si el contexto está fragmentado
          if (parsedData._isFragmented) {
            logger.debug('ContextManager: Contexto fragmentado detectado', { conversationId });
            
            // Cargar fragmentos
            const fragments = [];
            fragments.push({ type: 'base', data: parsedData });
            
            // Leer los archivos de fragmentos disponibles
            const fragmentFiles = fsSync.readdirSync(CONTEXTS_DIR)
              .filter(file => file.startsWith(`${conversationId}_fragment_`));
            
            for (const fragmentFile of fragmentFiles) {
              const fragmentData = await fs.readFile(path.join(CONTEXTS_DIR, fragmentFile), 'utf8');
              try {
                const fragment = JSON.parse(fragmentData);
                fragments.push(fragment);
              } catch (fragmentParseError) {
                logger.warn('ContextManager: Error al parsear fragmento', {
                  fragmentFile,
                  error: fragmentParseError.message
                });
              }
            }
            
            // Reensamblar contexto
            const reassembledContext = reassembleContext(fragments);
            return reassembledContext;
          }
          
          return parsedData;
        }, {
          retries: 3,
          onFailedAttempt: (error) => {
            logger.warn(`ContextManager: Reintentando cargar contexto (intento ${error.attemptNumber}/3)`, {
              conversationId,
              error: error.message
            });
          }
        });
        
        // Validar el contexto
        try {
          const { error, value } = contextMapSchema.validate(contextMap, {
            stripUnknown: false,
            abortEarly: false
          });
          
          if (error) {
            logger.warn('ContextManager: Validación de contexto falló', {
              conversationId,
              errors: error.details.map(d => d.message)
            });
          }
        } catch (validationError) {
          logger.error('ContextManager: Error en validación de contexto', {
            conversationId,
            error: validationError.message
          });
        }
        
        // Guardar en caché
        activeContexts.set(cacheKey, contextMap);
        logger.debug('ContextManager: Contexto cargado de disco', { conversationId, userId });
        
        return contextMap;
      } catch (readError) {
        logger.error(`ContextManager: Error al leer contexto para ${conversationId}:`, {
          error: readError.message,
          stack: readError.stack
        });
      }
    }
    
    // Si no existe, devolver objeto vacío
    return {};
  } catch (error) {
    logger.error(`ContextManager: Error al obtener contexto para ${conversationId}:`, {
      error: error.message,
      stack: error.stack
    });
    return {};
  }
}

/**
 * Actualiza el contexto de una conversación
 * @param {string} conversationId - ID de la conversación
 * @param {string} userId - ID del usuario (opcional)
 * @param {Object} contextMap - Nuevo mapa de contexto
 * @param {Object} options - Opciones adicionales
 * @returns {Promise<boolean>} True si se actualizó correctamente
 */
async function updateContextMap(conversationId, userId, contextMap, options = {}) {
  let lockId = null;
  
  try {
    if (!conversationId || !contextMap) {
      logger.warn('ContextManager: ID de conversación o mapa de contexto faltante');
      return false;
    }
    
    // Validar permisos si se especifica un userId
    if (userId && options.checkPermissions !== false) {
      const hasPermission = await checkUserPermission(userId, conversationId, 'write');
      if (!hasPermission) {
        logger.warn('ContextManager: Usuario sin permisos para actualizar contexto', {
          userId,
          conversationId
        });
        throw new Error(`Usuario ${userId} no tiene permisos para actualizar el contexto ${conversationId}`);
      }
    }
    
    // Adquirir bloqueo
    lockId = await acquireLock(conversationId);
    
    // Actualizar timestamp
    contextMap.lastUpdated = new Date().toISOString();
    
    // Validar el contexto
    const { error, value } = contextMapSchema.validate(contextMap, {
      stripUnknown: false,
      abortEarly: false
    });
    
    if (error) {
      logger.warn('ContextManager: Validación de contexto falló al actualizar', {
        conversationId,
        errors: error.details.map(d => d.message)
      });
      
      if (options.strictValidation) {
        throw new Error(`Validación de contexto falló: ${error.message}`);
      }
    }
    
    // Guardar versión en historial si está habilitado
    if (options.saveHistory !== false) {
      await saveContextHistory(conversationId, contextMap);
    }
    
    // Comprobar tamaño del contexto y fragmentar si es necesario
    const contextSize = Buffer.byteLength(JSON.stringify(contextMap), 'utf8');
    if (contextSize > MAX_CONTEXT_FRAGMENT_SIZE) {
      logger.info('ContextManager: Fragmentando contexto grande', {
        conversationId,
        sizeBytes: contextSize
      });
      
      const fragments = fragmentContext(contextMap);
      
      // Guardar fragmentos
      if (fragments.length > 1) {
        // Marcar el contexto base como fragmentado
        const baseFragment = { ...fragments[0].data, _isFragmented: true };
        
        // Guardar base
        await fs.writeFile(
          path.join(CONTEXTS_DIR, `${conversationId}.json`),
          JSON.stringify(baseFragment, null, 2),
          'utf8'
        );
        
        // Guardar fragmentos adicionales
        for (let i = 1; i < fragments.length; i++) {
          await fs.writeFile(
            path.join(CONTEXTS_DIR, `${conversationId}_fragment_${i}.json`),
            JSON.stringify(fragments[i], null, 2),
            'utf8'
          );
        }
      } else {
        // Si al final no se fragmentó (puede ocurrir en casos límite)
        await fs.writeFile(
          path.join(CONTEXTS_DIR, `${conversationId}.json`),
          JSON.stringify(contextMap, null, 2),
          'utf8'
        );
      }
    } else {
      // Guardar normalmente si no es necesario fragmentar
      await fs.writeFile(
        path.join(CONTEXTS_DIR, `${conversationId}.json`),
        JSON.stringify(contextMap, null, 2),
        'utf8'
      );
    }
    
    // Actualizar caché
    const cacheKey = `${conversationId}:${userId || 'anonymous'}`;
    activeContexts.set(cacheKey, contextMap);
    
    logger.debug('ContextManager: Contexto actualizado correctamente', { conversationId, userId });
    return true;
  } catch (error) {
    logger.error(`ContextManager: Error al actualizar contexto para ${conversationId}:`, {
      error: error.message,
      stack: error.stack
    });
    return false;
  } finally {
    // Liberar bloqueo si se adquirió
    if (lockId) {
      releaseLock(conversationId, lockId);
    }
  }
}

/**
 * Verifica si un usuario tiene permiso para una operación en un contexto
 * @param {string} userId - ID del usuario
 * @param {string} conversationId - ID de la conversación
 * @param {string} operation - Operación ('read', 'write', 'delete')
 * @returns {Promise<boolean>} True si tiene permiso
 * @private
 */
async function checkUserPermission(userId, conversationId, operation) {
  try {
    if (!userId) return true; // Si no hay userId, permitir (compatible con versión anterior)
    
    // Implementación básica - puede extenderse para consultar un servicio de autorización
    
    // Cargar el contexto para verificar propietario
    const contextPath = path.join(CONTEXTS_DIR, `${conversationId}.json`);
    if (fsSync.existsSync(contextPath)) {
      const contextData = await fs.readFile(contextPath, 'utf8');
      const contextMap = JSON.parse(contextData);
      
      // Si el contexto tiene un creador/propietario
      if (contextMap._ownerId && contextMap._ownerId !== userId) {
        // Verificar si el usuario está en la lista de usuarios autorizados
        if (Array.isArray(contextMap._authorizedUsers) && 
            contextMap._authorizedUsers.includes(userId)) {
          return true;
        }
        
        // Para operaciones de escritura y eliminación, solo el propietario
        if (operation === 'write' || operation === 'delete') {
          return false;
        }
      }
    }
    
    // Por defecto, permitir (compatible con versión anterior)
    return true;
  } catch (error) {
    logger.error('ContextManager: Error al verificar permisos:', {
      userId,
      conversationId,
      operation,
      error: error.message
    });
    
    // En caso de error, por seguridad denegar
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
      logger.error('ContextManager: Error al procesar documentos:', {
        error: docError.message,
        conversationId
      });
    }
    
    // Enriquecer con memoria global
    try {
      enrichedContext = await globalMemory.enrichContextWithGlobalMemory(enrichedContext);
    } catch (globalMemoryError) {
      logger.error('ContextManager: Error al enriquecer con memoria global:', {
        error: globalMemoryError.message,
        conversationId
      });
    }
    
    return enrichedContext;
  } catch (error) {
    logger.error(`ContextManager: Error al enriquecer contexto para ${conversationId}:`, {
      error: error.message,
      stack: error.stack
    });
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
      logger.warn('ContextManager: ID de conversación o mensaje faltante');
      return {};
    }
    
    // Analizar mensaje con el analizador de contexto
    const contextMap = await pRetry(() => contextAnalyzer.analyzeMessage(
      conversationId,
      userId,
      message
    ), {
      retries: 2,
      onFailedAttempt: (error) => {
        logger.warn('ContextManager: Reintento de análisis de mensaje', {
          conversationId,
          attempt: error.attemptNumber,
          error: error.message
        });
      }
    });
    
    // Enriquecer contexto con información adicional
    const enrichedContext = await enrichContext(conversationId, contextMap);
    
    // Guardar contexto enriquecido
    await updateContextMap(conversationId, userId, enrichedContext);
    
    return enrichedContext;
  } catch (error) {
    logger.error(`ContextManager: Error al procesar mensaje para ${conversationId}:`, {
      error: error.message,
      stack: error.stack
    });
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
      logger.warn('ContextManager: ID de conversación o contexto faltante');
      return contextMap || {};
    }
    
    // Actualizar el contexto con la respuesta
    const updatedContext = await pRetry(() => contextAnalyzer.updateAfterResponse(
      conversationId,
      userId,
      contextMap,
      userMessage,
      botResponse
    ), {
      retries: 2,
      onFailedAttempt: (error) => {
        logger.warn('ContextManager: Reintento de actualización post-respuesta', {
          conversationId,
          attempt: error.attemptNumber,
          error: error.message
        });
      }
    });
    
    // Actualizar memoria global
    try {
      await globalMemory.updateGlobalMemory(
        contextMap,
        userMessage,
        botResponse,
        conversationId
      );
    } catch (globalMemoryError) {
      logger.error('ContextManager: Error al actualizar memoria global:', {
        error: globalMemoryError.message,
        conversationId
      });
    }
    
    // Guardar contexto actualizado
    await updateContextMap(conversationId, userId, updatedContext, { saveHistory: true });
    
    return updatedContext;
  } catch (error) {
    logger.error(`ContextManager: Error al procesar respuesta para ${conversationId}:`, {
      error: error.message,
      stack: error.stack
    });
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
    
    // Ejecutar búsquedas en paralelo para mejorar rendimiento
    const [entities, memoryItems, documents] = await Promise.all([
      entityExtractor.searchEntities(query).catch(err => {
        logger.error('ContextManager: Error al buscar entidades', {
          error: err.message,
          conversationId
        });
        return [];
      }),
      
      memoryStore.searchMemory(conversationId, query).catch(err => {
        logger.error('ContextManager: Error al buscar en memoria', {
          error: err.message,
          conversationId
        });
        return [];
      }),
      
      documentProcessor.searchDocuments(conversationId, query).catch(err => {
        logger.error('ContextManager: Error al buscar en documentos', {
          error: err.message,
          conversationId
        });
        return [];
      })
    ]);
    
    return {
      entities,
      memory: memoryItems,
      documents
    };
  } catch (error) {
    logger.error(`ContextManager: Error al buscar contexto para ${conversationId}:`, {
      error: error.message,
      query
    });
    return { entities: [], memory: [], documents: [] };
  }
}

/**
 * Elimina el contexto de una conversación
 * @param {string} conversationId - ID de la conversación
 * @param {string} userId - ID del usuario (opcional)
 * @returns {Promise<boolean>} True si se eliminó correctamente
 */
async function deleteContext(conversationId, userId = null) {
  let lockId = null;
  
  try {
    if (!conversationId) {
      return false;
    }
    
    // Verificar permisos si hay userId
    if (userId) {
      const hasPermission = await checkUserPermission(userId, conversationId, 'delete');
      if (!hasPermission) {
        logger.warn('ContextManager: Usuario sin permisos para eliminar contexto', {
          userId,
          conversationId
        });
        return false;
      }
    }
    
    // Adquirir bloqueo
    lockId = await acquireLock(conversationId);
    
    const contextPath = path.join(CONTEXTS_DIR, `${conversationId}.json`);
    
    // Eliminar fragmentos si existen
    const fragmentFiles = fsSync.readdirSync(CONTEXTS_DIR)
      .filter(file => file.startsWith(`${conversationId}_fragment_`));
    
    for (const fragmentFile of fragmentFiles) {
      await fs.unlink(path.join(CONTEXTS_DIR, fragmentFile));
    }
    
    // Eliminar archivo principal si existe
    if (fsSync.existsSync(contextPath)) {
      await fs.unlink(contextPath);
    }
    
    // Eliminar de caché
    for (const key of [...activeContexts.keys()]) {
      if (key.startsWith(`${conversationId}:`)) {
        activeContexts.delete(key);
      }
    }
    
    logger.info('ContextManager: Contexto eliminado', { conversationId });
    return true;
  } catch (error) {
    logger.error(`ContextManager: Error al eliminar contexto para ${conversationId}:`, {
      error: error.message
    });
    return false;
  } finally {
    // Liberar bloqueo si se adquirió
    if (lockId) {
      releaseLock(conversationId, lockId);
    }
  }
}

/**
 * Obtiene estadísticas sobre los contextos almacenados
 * @returns {Promise<Object>} Estadísticas de contexto
 */
async function getContextStats() {
  try {
    if (!fsSync.existsSync(CONTEXTS_DIR)) {
      return {
        totalContexts: 0,
        activeContextsCount: 0,
        averageSize: 0,
        fragmentedContexts: 0,
        historyVersions: 0
      };
    }
    
    const files = fsSync.readdirSync(CONTEXTS_DIR)
      .filter(file => file.endsWith('.json') && !file.includes('_fragment_'));
    
    let totalSize = 0;
    let fragmentedCount = 0;
    
    for (const file of files) {
      try {
        const filePath = path.join(CONTEXTS_DIR, file);
        const stats = fsSync.statSync(filePath);
        totalSize += stats.size;
        
        // Comprobar si está fragmentado
        const contextData = await fs.readFile(filePath, 'utf8');
        const contextMap = JSON.parse(contextData);
        if (contextMap._isFragmented) {
          fragmentedCount++;
        }
      } catch (err) {
        // Ignorar archivos con error
        logger.warn('ContextManager: Error al procesar archivo para estadísticas', {
          file,
          error: err.message
        });
      }
    }
    
    // Contar versiones de historial
    const historyFiles = fsSync.existsSync(HISTORY_DIR) ? 
      fsSync.readdirSync(HISTORY_DIR).filter(file => file.endsWith('.json')) :
      [];
    
    const averageSize = files.length > 0 ? Math.round(totalSize / files.length) : 0;
    
    return {
      totalContexts: files.length,
      activeContextsCount: activeContexts.size,
      averageSize,
      fragmentedContexts: fragmentedCount,
      historyVersions: historyFiles.length
    };
  } catch (error) {
    logger.error('ContextManager: Error al obtener estadísticas de contexto:', {
      error: error.message
    });
    return {
      totalContexts: 0,
      activeContextsCount: 0,
      averageSize: 0,
      fragmentedContexts: 0,
      historyVersions: 0,
      error: error.message
    };
  }
}

/**
 * Recupera un contexto de una versión específica
 * @param {string} conversationId - ID de la conversación
 * @param {string} versionId - ID de la versión a recuperar
 * @returns {Promise<Object>} Contexto de la versión solicitada
 */
async function getContextVersion(conversationId, versionId) {
  try {
    if (!conversationId || !versionId) {
      logger.warn('ContextManager: ID de conversación o versión faltantes');
      return null;
    }
    
    const historyPath = path.join(HISTORY_DIR, `${conversationId}_${versionId}.json`);
    
    if (!fsSync.existsSync(historyPath)) {
      logger.warn('ContextManager: Versión de contexto no encontrada', {
        conversationId,
        versionId
      });
      return null;
    }
    
    const contextData = await fs.readFile(historyPath, 'utf8');
    return JSON.parse(contextData);
  } catch (error) {
    logger.error('ContextManager: Error al recuperar versión de contexto', {
      conversationId,
      versionId,
      error: error.message
    });
    return null;
  }
}

/**
 * Obtiene el historial de versiones de un contexto
 * @param {string} conversationId - ID de la conversación
 * @returns {Promise<Array>} Lista de versiones disponibles
 */
async function getContextVersions(conversationId) {
  try {
    if (!conversationId) {
      return [];
    }
    
    if (!fsSync.existsSync(HISTORY_DIR)) {
      return [];
    }
    
    const versionFiles = fsSync.readdirSync(HISTORY_DIR)
      .filter(file => file.startsWith(`${conversationId}_`) && file.endsWith('.json'));
    
    const versions = [];
    
    for (const file of versionFiles) {
      try {
        const filePath = path.join(HISTORY_DIR, file);
        const stats = fsSync.statSync(filePath);
        
        // Extraer versionId del nombre del archivo
        const versionId = file.replace(`${conversationId}_`, '').replace('.json', '');
        
        const contextData = await fs.readFile(filePath, 'utf8');
        const contextMap = JSON.parse(contextData);
        
        versions.push({
          versionId,
          timestamp: contextMap._versionTimestamp || stats.mtime.toISOString(),
          size: stats.size
        });
      } catch (err) {
        logger.warn('ContextManager: Error al procesar versión', {
          file,
          error: err.message
        });
      }
    }
    
    // Ordenar por timestamp, más reciente primero
    return versions.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  } catch (error) {
    logger.error('ContextManager: Error al obtener versiones de contexto', {
      conversationId,
      error: error.message
    });
    return [];
  }
}

/**
 * Fusiona dos contextos
 * @param {Object} targetContext - Contexto destino
 * @param {Object} sourceContext - Contexto fuente
 * @param {Object} options - Opciones de fusión
 * @returns {Object} Contexto fusionado
 */
function mergeContexts(targetContext, sourceContext, options = {}) {
  try {
    if (!targetContext) return sourceContext || {};
    if (!sourceContext) return targetContext;
    
    const mergedContext = { ...targetContext };
    
    // Estrategia por defecto
    const strategy = options.strategy || 'smart';
    
    for (const [key, value] of Object.entries(sourceContext)) {
      // Ignorar claves internas
      if (key.startsWith('_')) continue;
      
      // Si la clave no existe en el destino, copiarla
      if (!(key in mergedContext)) {
        mergedContext[key] = value;
        continue;
      }
      
      // Si ambos son arrays
      if (Array.isArray(mergedContext[key]) && Array.isArray(value)) {
        if (strategy === 'append') {
          // Simplemente concatenar
          mergedContext[key] = [...mergedContext[key], ...value];
        } else if (strategy === 'replace') {
          // Reemplazar completamente
          mergedContext[key] = [...value];
        } else {
          // Estrategia inteligente: añadir sin duplicar
          const existingSet = new Set(mergedContext[key].map(item => 
            typeof item === 'object' ? JSON.stringify(item) : item
          ));
          
          const newItems = value.filter(item => {
            const itemKey = typeof item === 'object' ? JSON.stringify(item) : item;
            return !existingSet.has(itemKey);
          });
          
          mergedContext[key] = [...mergedContext[key], ...newItems];
        }
      }
      // Si ambos son objetos (pero no arrays)
      else if (
        typeof mergedContext[key] === 'object' && mergedContext[key] !== null &&
        typeof value === 'object' && value !== null &&
        !Array.isArray(mergedContext[key]) && !Array.isArray(value)
      ) {
        // Fusionar recursivamente
        mergedContext[key] = mergeContexts(mergedContext[key], value, options);
      }
      // Para otros tipos, usar la estrategia especificada
      else {
        if (strategy === 'keep') {
          // Mantener el valor existente
        } else {
          // Por defecto, reemplazar con el nuevo valor
          mergedContext[key] = value;
        }
      }
    }
    
    return mergedContext;
  } catch (error) {
    logger.error('ContextManager: Error al fusionar contextos', {
      error: error.message
    });
    return targetContext;
  }
}

// Inicializar el módulo asíncronamente
(async () => {
  try {
    await init();
  } catch (error) {
    logger.error('ContextManager: Error al inicializar', {
      error: error.message,
      stack: error.stack
    });
  }
})();

module.exports = {
  getContextMap,
  updateContextMap,
  enrichContext,
  processMessage,
  processResponse,
  searchContext,
  deleteContext,
  getContextStats,
  // Nuevas funciones
  getContextVersion,
  getContextVersions,
  mergeContexts
};
