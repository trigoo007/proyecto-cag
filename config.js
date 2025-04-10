/**
 * Módulo de configuración para la aplicación CAG
 * Maneja carga y actualización de la configuración con soporte para
 * operaciones asíncronas, validación mejorada, diferentes entornos y
 * sistema de caché en memoria.
 * 
 * @module config
 */

const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const crypto = require('crypto');
const winston = require('winston');
const Ajv = require('ajv');

// Configuración del logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' })
  ]
});

// Determinar el entorno actual
const ENV = process.env.NODE_ENV || 'development';

// Rutas a los archivos de configuración
const CONFIG_DIR = path.join(__dirname, 'data');
const CONFIG_PATH = path.join(CONFIG_DIR, `config.${ENV}.json`);
const ENCRYPTION_KEY = process.env.CONFIG_ENCRYPTION_KEY || 'defaultEncryptionKey12345678901234567890';

// Sistema de caché en memoria con tiempo de expiración
let configCache = {
  data: null,
  timestamp: 0,
  ttl: 60000 // 1 minuto en milisegundos
};

// Throttling para escrituras
let lastWriteTime = 0;
const WRITE_THROTTLE = 2000; // 2 segundos entre escrituras

// Esquema de validación para la configuración
const configSchema = {
  type: 'object',
  properties: {
    temperature: { 
      type: 'number', 
      minimum: 0, 
      maximum: 1 
    },
    max_tokens: { 
      type: 'integer', 
      minimum: 100, 
      maximum: 8192 
    },
    system_prompt: { 
      type: 'string',
      minLength: 10,
      maxLength: 1000
    },
    response_format: { 
      type: 'string',
      enum: ['markdown', 'text', 'json', 'html']
    },
    model: { 
      type: 'string',
      pattern: '^[a-zA-Z0-9:]+$'
    },
    memory_settings: {
      type: 'object',
      properties: {
        max_conversation_history: { 
          type: 'integer', 
          minimum: 1, 
          maximum: 100 
        },
        cross_conversation_memory: { 
          type: 'boolean' 
        }
      },
      required: ['max_conversation_history', 'cross_conversation_memory']
    }
  },
  required: ['temperature', 'max_tokens', 'system_prompt', 'response_format', 'model', 'memory_settings'],
  additionalProperties: true
};

const validator = new Ajv().compile(configSchema);

// Configuración por defecto para diferentes entornos
const DEFAULT_CONFIGS = {
  development: {
    temperature: 0.7,
    max_tokens: 2048,
    system_prompt: 'Eres un asistente amable y útil que responde de forma clara y organizada.',
    response_format: 'markdown',
    model: 'gemma3:27b',
    memory_settings: {
      max_conversation_history: 20,
      cross_conversation_memory: true
    },
    debug: true
  },
  production: {
    temperature: 0.5,
    max_tokens: 1024,
    system_prompt: 'Eres un asistente amable y útil que responde de forma clara y organizada.',
    response_format: 'markdown',
    model: 'gemma3:27b',
    memory_settings: {
      max_conversation_history: 10,
      cross_conversation_memory: false
    },
    debug: false
  },
  test: {
    temperature: 0.7,
    max_tokens: 500,
    system_prompt: 'Eres un asistente de prueba.',
    response_format: 'markdown',
    model: 'gemma3:7b',
    memory_settings: {
      max_conversation_history: 5,
      cross_conversation_memory: false
    },
    debug: true
  }
};

// Usamos el entorno actual para determinar la configuración por defecto
const DEFAULT_CONFIG = DEFAULT_CONFIGS[ENV] || DEFAULT_CONFIGS.development;

/**
 * Encripta datos sensibles
 * @param {Object} data - Datos a encriptar
 * @param {Array<string>} sensitiveKeys - Lista de claves que contienen datos sensibles
 * @returns {Object} - Datos con campos sensibles encriptados
 */
function encryptSensitiveData(data, sensitiveKeys = ['system_prompt']) {
  const result = { ...data };
  
  for (const key of sensitiveKeys) {
    if (result[key] && typeof result[key] === 'string') {
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
      let encrypted = cipher.update(result[key], 'utf8', 'hex');
      encrypted += cipher.final('hex');
      result[key] = {
        iv: iv.toString('hex'),
        data: encrypted
      };
    }
  }
  
  return result;
}

/**
 * Desencripta datos sensibles
 * @param {Object} data - Datos con campos encriptados
 * @param {Array<string>} sensitiveKeys - Lista de claves que contienen datos sensibles
 * @returns {Object} - Datos con campos sensibles desencriptados
 */
function decryptSensitiveData(data, sensitiveKeys = ['system_prompt']) {
  const result = { ...data };
  
  for (const key of sensitiveKeys) {
    if (result[key] && typeof result[key] === 'object' && result[key].iv && result[key].data) {
      try {
        const iv = Buffer.from(result[key].iv, 'hex');
        const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
        let decrypted = decipher.update(result[key].data, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        result[key] = decrypted;
      } catch (error) {
        logger.error(`Error al desencriptar ${key}:`, error);
        result[key] = DEFAULT_CONFIG[key]; // Valor por defecto en caso de error
      }
    }
  }
  
  return result;
}

/**
 * Inicializa la configuración para el entorno actual
 * @async
 * @returns {Promise<void>}
 * @throws {Error} Si ocurre un error en la inicialización
 */
async function init() {
  try {
    // Crear directorio de datos si no existe
    try {
      await fs.access(CONFIG_DIR);
    } catch (error) {
      logger.info('Config: Creando directorio de datos');
      await fs.mkdir(CONFIG_DIR, { recursive: true, mode: 0o750 }); // Permisos restrictivos
    }
    
    // Verificar si existe el archivo de configuración
    try {
      await fs.access(CONFIG_PATH);
      logger.info(`Config: Archivo de configuración para ${ENV} encontrado`);
      
      // Verificar que la config existente tenga todos los campos necesarios
      const existingConfig = JSON.parse(await fs.readFile(CONFIG_PATH, 'utf8'));
      const decryptedConfig = decryptSensitiveData(existingConfig);
      
      // Asegurar que hay nuevos parámetros predeterminados
      let needsUpdate = false;
      for (const key in DEFAULT_CONFIG) {
        if (decryptedConfig[key] === undefined) {
          needsUpdate = true;
          break;
        }
      }
      
      if (needsUpdate) {
        const updatedConfig = { ...DEFAULT_CONFIG, ...decryptedConfig };
        const isValid = validator(updatedConfig);
        
        if (!isValid) {
          logger.warn('Config: La configuración actualizada tiene errores de validación:', validator.errors);
        }
        
        const encryptedConfig = encryptSensitiveData(updatedConfig);
        await fs.writeFile(
          CONFIG_PATH, 
          JSON.stringify(encryptedConfig, null, 2), 
          { encoding: 'utf8', mode: 0o640 } // Permisos restrictivos
        );
        logger.info('Config: Archivo de configuración actualizado con nuevos parámetros');
      }
    } catch (error) {
      if (error.code === 'ENOENT') {
        // Archivo no existe, crear uno nuevo
        logger.info(`Config: Creando archivo de configuración para ${ENV} con valores por defecto`);
        const encryptedConfig = encryptSensitiveData(DEFAULT_CONFIG);
        await fs.writeFile(
          CONFIG_PATH, 
          JSON.stringify(encryptedConfig, null, 2), 
          { encoding: 'utf8', mode: 0o640 } // Permisos restrictivos
        );
      } else {
        // Error al leer archivo, recrear con valores por defecto
        logger.error('Config: Error al verificar la configuración existente:', error);
        logger.info('Config: Restaurando configuración por defecto');
        const encryptedConfig = encryptSensitiveData(DEFAULT_CONFIG);
        await fs.writeFile(
          CONFIG_PATH, 
          JSON.stringify(encryptedConfig, null, 2), 
          { encoding: 'utf8', mode: 0o640 } // Permisos restrictivos
        );
      }
    }
  } catch (error) {
    logger.error('Config: Error crítico en inicialización:', error);
    throw new Error(`No se pudo inicializar la configuración: ${error.message}`);
  }
}

/**
 * Obtiene la configuración actual
 * @async
 * @param {boolean} [useCache=true] - Si debe usar la caché o forzar lectura de disco
 * @returns {Promise<Object>} La configuración actual validada
 */
async function get(useCache = true) {
  try {
    // Verificar caché válida
    const now = Date.now();
    if (useCache && configCache.data && (now - configCache.timestamp < configCache.ttl)) {
      logger.debug('Config: Usando configuración en caché');
      return configCache.data;
    }
    
    // Verificar si existe el archivo
    try {
      await fs.access(CONFIG_PATH);
    } catch (error) {
      logger.warn(`Config: Archivo de configuración para ${ENV} no encontrado, usando valores por defecto`);
      
      // Actualizar caché
      configCache = {
        data: { ...DEFAULT_CONFIG },
        timestamp: now,
        ttl: configCache.ttl
      };
      
      return configCache.data;
    }
    
    // Leer y parsear configuración
    const data = await fs.readFile(CONFIG_PATH, 'utf8');
    const encryptedConfig = JSON.parse(data);
    const config = decryptSensitiveData(encryptedConfig);
    
    // Validar configuración
    const isValid = validator(config);
    
    if (!isValid) {
      logger.warn('Config: La configuración tiene errores de validación:', validator.errors);
      
      // Corregir valores inválidos con valores por defecto
      const correctedConfig = { ...config };
      
      for (const error of validator.errors || []) {
        const path = error.instancePath.substring(1).split('/');
        let current = correctedConfig;
        let defaultCurrent = DEFAULT_CONFIG;
        
        // Navegar hasta el valor anidado que necesita corrección
        for (let i = 0; i < path.length - 1; i++) {
          if (!current[path[i]]) {
            current[path[i]] = {};
          }
          current = current[path[i]];
          defaultCurrent = defaultCurrent[path[i]];
        }
        
        // Corregir el valor
        const lastKey = path[path.length - 1];
        if (lastKey) {
          logger.warn(`Config: Corrigiendo valor inválido para ${path.join('.')}. Usando valor por defecto`);
          current[lastKey] = defaultCurrent[lastKey];
        }
      }
      
      // Actualizar caché con valores corregidos
      configCache = {
        data: correctedConfig,
        timestamp: now,
        ttl: configCache.ttl
      };
      
      return correctedConfig;
    }
    
    // Actualizar caché con configuración válida
    configCache = {
      data: config,
      timestamp: now,
      ttl: configCache.ttl
    };
    
    return config;
  } catch (error) {
    logger.error('Config: Error al obtener configuración:', error);
    
    // En caso de error, devolver valores por defecto
    return { ...DEFAULT_CONFIG };
  }
}

/**
 * Actualiza la configuración
 * @async
 * @param {Object} newConfig - Nueva configuración parcial
 * @param {number} [cacheTTL] - Opcional: nuevo tiempo de vida de caché en ms
 * @returns {Promise<Object>} La configuración actualizada y validada
 * @throws {Error} Si la configuración es inválida o hay un error al actualizar
 */
async function update(newConfig, cacheTTL = null) {
  try {
    // Implementar throttling para escrituras
    const now = Date.now();
    if (now - lastWriteTime < WRITE_THROTTLE) {
      await new Promise(resolve => setTimeout(resolve, WRITE_THROTTLE));
    }
    lastWriteTime = Date.now();
    
    // Obtener configuración actual
    const currentConfig = await get(false); // No usar caché
    
    // Si se proporciona un nuevo TTL para la caché, actualizarlo
    if (cacheTTL !== null && typeof cacheTTL === 'number' && cacheTTL > 0) {
      configCache.ttl = cacheTTL;
      logger.info(`Config: TTL de caché actualizado a ${cacheTTL}ms`);
    }
    
    // Combinar configuraciones
    const combinedConfig = { ...currentConfig, ...newConfig };
    
    // Validar configuración completa
    const isValid = validator(combinedConfig);
    
    if (!isValid) {
      logger.error('Config: Errores de validación en la nueva configuración:', validator.errors);
      throw new Error('Configuración inválida: ' + JSON.stringify(validator.errors));
    }
    
    // Encriptar datos sensibles
    const encryptedConfig = encryptSensitiveData(combinedConfig);
    
    // Guardar configuración
    await fs.writeFile(
      CONFIG_PATH, 
      JSON.stringify(encryptedConfig, null, 2), 
      { encoding: 'utf8', mode: 0o640 } // Permisos restrictivos
    );
    
    logger.info('Config: Configuración actualizada correctamente');
    
    // Actualizar caché
    configCache = {
      data: combinedConfig,
      timestamp: Date.now(),
      ttl: configCache.ttl
    };
    
    return combinedConfig;
  } catch (error) {
    logger.error('Config: Error al actualizar configuración:', error);
    throw new Error('No se pudo actualizar la configuración: ' + error.message);
  }
}

/**
 * Restablece la configuración a los valores por defecto para el entorno actual
 * @async
 * @returns {Promise<Object>} La configuración por defecto
 * @throws {Error} Si hay un error al restablecer la configuración
 */
async function reset() {
  try {
    // Encriptar datos sensibles
    const encryptedConfig = encryptSensitiveData(DEFAULT_CONFIG);
    
    // Guardar configuración por defecto
    await fs.writeFile(
      CONFIG_PATH, 
      JSON.stringify(encryptedConfig, null, 2), 
      { encoding: 'utf8', mode: 0o640 } // Permisos restrictivos
    );
    
    logger.info(`Config: Configuración para ${ENV} restablecida a valores por defecto`);
    
    // Actualizar caché
    configCache = {
      data: { ...DEFAULT_CONFIG },
      timestamp: Date.now(),
      ttl: configCache.ttl
    };
    
    return { ...DEFAULT_CONFIG };
  } catch (error) {
    logger.error('Config: Error al restablecer configuración:', error);
    throw new Error('No se pudo restablecer la configuración: ' + error.message);
  }
}

/**
 * Configura el tiempo de vida de la caché
 * @param {number} ttl - Tiempo de vida en milisegundos
 */
function setCacheTTL(ttl) {
  if (typeof ttl === 'number' && ttl >= 0) {
    configCache.ttl = ttl;
    logger.info(`Config: TTL de caché configurado a ${ttl}ms`);
    
    // Si ttl es 0, invalidar caché
    if (ttl === 0) {
      configCache.data = null;
      configCache.timestamp = 0;
    }
  } else {
    logger.warn('Config: Valor inválido para TTL de caché');
  }
}

/**
 * Obtiene el entorno actual
 * @returns {string} Nombre del entorno
 */
function getEnvironment() {
  return ENV;
}

/**
 * Cambia entre entornos y carga la configuración correspondiente
 * @async
 * @param {string} newEnv - Nuevo entorno ('development', 'production', 'test')
 * @returns {Promise<Object>} La configuración del nuevo entorno
 */
async function switchEnvironment(newEnv) {
  if (!['development', 'production', 'test'].includes(newEnv)) {
    throw new Error(`Entorno inválido: ${newEnv}`);
  }
  
  // Almacenar entorno anterior para poder revertir en caso de error
  const previousEnv = ENV;
  
  try {
    // Actualizar entorno global
    process.env.NODE_ENV = newEnv;
    
    // Reiniciar variables con nuevos valores
    configCache.data = null;
    configCache.timestamp = 0;
    
    // Usar configuración por defecto para el nuevo entorno
    return await get(false); // Forzar lectura del disco
  } catch (error) {
    // Revertir al entorno anterior en caso de error
    process.env.NODE_ENV = previousEnv;
    logger.error(`Config: Error al cambiar al entorno ${newEnv}:`, error);
    throw new Error(`No se pudo cambiar al entorno ${newEnv}: ${error.message}`);
  }
}

/**
 * Obtiene la configuración para un usuario específico
 * @async
 * @param {string} userId - Identificador del usuario
 * @returns {Promise<Object>} Configuración personalizada del usuario
 */
async function getUserConfig(userId) {
  if (!userId) {
    throw new Error('Se requiere un ID de usuario válido');
  }
  
  try {
    const userConfigPath = path.join(CONFIG_DIR, `user_${userId}.json`);
    
    try {
      await fs.access(userConfigPath);
      const userData = await fs.readFile(userConfigPath, 'utf8');
      const userConfig = JSON.parse(userData);
      const decryptedConfig = decryptSensitiveData(userConfig);
      
      // Obtener configuración global
      const globalConfig = await get();
      
      // Combinar configuraciones con prioridad para la configuración de usuario
      return { ...globalConfig, ...decryptedConfig };
    } catch (error) {
      if (error.code === 'ENOENT') {
        // No existe configuración para este usuario, usar la global
        return await get();
      }
      throw error;
    }
  } catch (error) {
    logger.error(`Config: Error al obtener configuración de usuario ${userId}:`, error);
    return await get(); // En caso de error, devolver configuración global
  }
}

/**
 * Actualiza la configuración para un usuario específico
 * @async
 * @param {string} userId - Identificador del usuario
 * @param {Object} newConfig - Nueva configuración parcial
 * @returns {Promise<Object>} La configuración de usuario actualizada
 */
async function updateUserConfig(userId, newConfig) {
  if (!userId) {
    throw new Error('Se requiere un ID de usuario válido');
  }
  
  try {
    const userConfigPath = path.join(CONFIG_DIR, `user_${userId}.json`);
    let currentUserConfig = {};
    
    // Intentar obtener configuración actual del usuario
    try {
      await fs.access(userConfigPath);
      const userData = await fs.readFile(userConfigPath, 'utf8');
      const encryptedUserConfig = JSON.parse(userData);
      currentUserConfig = decryptSensitiveData(encryptedUserConfig);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
      // Si no existe el archivo, se usará un objeto vacío
    }
    
    // Combinar configuraciones
    const combinedConfig = { ...currentUserConfig, ...newConfig };
    
    // Validar configuración
    const globalConfig = await get();
    const fullConfig = { ...globalConfig, ...combinedConfig };
    const isValid = validator(fullConfig);
    
    if (!isValid) {
      logger.error('Config: Errores de validación en la configuración de usuario:', validator.errors);
      throw new Error('Configuración de usuario inválida: ' + JSON.stringify(validator.errors));
    }
    
    // Encriptar y guardar
    const encryptedConfig = encryptSensitiveData(combinedConfig);
    await fs.writeFile(
      userConfigPath, 
      JSON.stringify(encryptedConfig, null, 2), 
      { encoding: 'utf8', mode: 0o640 } // Permisos restrictivos
    );
    
    logger.info(`Config: Configuración de usuario ${userId} actualizada correctamente`);
    return fullConfig;
  } catch (error) {
    logger.error(`Config: Error al actualizar configuración de usuario ${userId}:`, error);
    throw new Error(`No se pudo actualizar la configuración de usuario: ${error.message}`);
  }
}

/**
 * Elimina la configuración de un usuario específico
 * @async
 * @param {string} userId - Identificador del usuario
 * @returns {Promise<boolean>} true si se eliminó correctamente
 */
async function deleteUserConfig(userId) {
  if (!userId) {
    throw new Error('Se requiere un ID de usuario válido');
  }
  
  try {
    const userConfigPath = path.join(CONFIG_DIR, `user_${userId}.json`);
    
    try {
      await fs.access(userConfigPath);
      await fs.unlink(userConfigPath);
      logger.info(`Config: Configuración de usuario ${userId} eliminada correctamente`);
      return true;
    } catch (error) {
      if (error.code === 'ENOENT') {
        // El archivo no existe, considerar como éxito
        return true;
      }
      throw error;
    }
  } catch (error) {
    logger.error(`Config: Error al eliminar configuración de usuario ${userId}:`, error);
    throw new Error(`No se pudo eliminar la configuración de usuario: ${error.message}`);
  }
}

/**
 * Versión sincrónica de obtener configuración para uso en inicialización
 * @deprecated Usar la versión asíncrona cuando sea posible
 * @returns {Object} La configuración actual
 */
function getSync() {
  try {
    // Verificar caché válida
    const now = Date.now();
    if (configCache.data && (now - configCache.timestamp < configCache.ttl)) {
      return configCache.data;
    }
    
    // Verificar si existe el archivo
    if (!fsSync.existsSync(CONFIG_PATH)) {
      return { ...DEFAULT_CONFIG };
    }
    
    // Leer y parsear configuración
    const data = fsSync.readFileSync(CONFIG_PATH, 'utf8');
    const encryptedConfig = JSON.parse(data);
    const config = decryptSensitiveData(encryptedConfig);
    
    // Actualizar caché
    configCache = {
      data: config,
      timestamp: now,
      ttl: configCache.ttl
    };
    
    return config;
  } catch (error) {
    console.error('Config: Error al obtener configuración de forma sincrónica:', error);
    return { ...DEFAULT_CONFIG };
  }
}

module.exports = {
  init,
  get,
  update,
  reset,
  getSync,
  setCacheTTL,
  getEnvironment,
  switchEnvironment,
  getUserConfig,
  updateUserConfig,
  deleteUserConfig,
  DEFAULT_CONFIG,
  DEFAULT_CONFIGS
};
