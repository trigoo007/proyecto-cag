/**
 * Módulo de base de datos para la aplicación CAG
 * Implementa almacenamiento basado en MongoDB para las conversaciones
 * Mantiene compatibilidad con la API original basada en archivos
 */

const { MongoClient } = require('mongodb');
const fs = require('fs').promises;
const path = require('path');
const zlib = require('zlib');
const util = require('util');
const crypto = require('crypto');

// Promisificar funciones de zlib
const gzip = util.promisify(zlib.gzip);
const gunzip = util.promisify(zlib.gunzip);

// Configuración de MongoDB (usar variables de entorno para producción)
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017';
const DB_NAME = process.env.DB_NAME || 'cag';
const COLLECTION_NAME = 'conversations';

// Directorio para almacenar los respaldos
const DATA_DIR = path.join(__dirname, 'data');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');

// Cliente MongoDB y referencias de colección
let client = null;
let db = null;
let conversations = null;

// Esquema de validación para conversaciones
const conversationSchema = {
  required: ['id', 'created_at'],
  properties: {
    id: { type: 'string' },
    title: { type: 'string' },
    created_at: { type: 'string', format: 'date-time' },
    lastUpdated: { type: 'string', format: 'date-time' },
    lastActive: { type: 'string', format: 'date-time' },
    messages: {
      type: 'array',
      items: {
        type: 'object',
        required: ['role', 'content'],
        properties: {
          role: { type: 'string', enum: ['user', 'assistant', 'system'] },
          content: { type: 'string' },
          timestamp: { type: 'string', format: 'date-time' }
        }
      }
    }
  }
};

// Método para encriptar datos sensibles
const encryptData = (data, key = process.env.ENCRYPTION_KEY) => {
  if (!key) return data; // Si no hay clave, devolver los datos sin encriptar
  
  try {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(key, 'hex'), iv);
    let encrypted = cipher.update(JSON.stringify(data), 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    
    return {
      iv: iv.toString('hex'),
      authTag,
      content: encrypted,
      encrypted: true
    };
  } catch (error) {
    console.error('DB: Error al encriptar datos:', error);
    return data;
  }
};

// Método para desencriptar datos
const decryptData = (encryptedData, key = process.env.ENCRYPTION_KEY) => {
  if (!encryptedData.encrypted || !key) return encryptedData;
  
  try {
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm', 
      Buffer.from(key, 'hex'), 
      Buffer.from(encryptedData.iv, 'hex')
    );
    
    decipher.setAuthTag(Buffer.from(encryptedData.authTag, 'hex'));
    
    let decrypted = decipher.update(encryptedData.content, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return JSON.parse(decrypted);
  } catch (error) {
    console.error('DB: Error al desencriptar datos:', error);
    return encryptedData;
  }
};

/**
 * Valida un objeto de conversación contra el esquema
 * @param {Object} conversation - Objeto de conversación a validar
 * @returns {Object} { valid: boolean, errors: Array }
 */
function validateConversation(conversation) {
  // Implementación simple de validación
  const errors = [];
  
  // Verificar campos requeridos
  if (!conversation.id) errors.push('Falta el campo obligatorio: id');
  if (!conversation.created_at) errors.push('Falta el campo obligatorio: created_at');
  
  // Verificar formato de fechas
  const dateFields = ['created_at', 'lastUpdated', 'lastActive'];
  dateFields.forEach(field => {
    if (conversation[field] && isNaN(new Date(conversation[field]).getTime())) {
      errors.push(`Formato de fecha inválido en: ${field}`);
    }
  });
  
  // Verificar estructura de mensajes
  if (conversation.messages) {
    if (!Array.isArray(conversation.messages)) {
      errors.push('El campo messages debe ser un array');
    } else {
      conversation.messages.forEach((msg, index) => {
        if (!msg.role || !['user', 'assistant', 'system'].includes(msg.role)) {
          errors.push(`Mensaje ${index}: role inválido o faltante`);
        }
        if (!msg.content && msg.content !== '') {
          errors.push(`Mensaje ${index}: content inválido o faltante`);
        }
      });
    }
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Inicializa la conexión a la base de datos
 * @returns {Promise<boolean>} True si se inicializó correctamente
 */
async function init() {
  try {
    // Crear directorio de backups si no existe
    await fs.mkdir(BACKUP_DIR, { recursive: true });
    
    // Conectar a MongoDB
    client = new MongoClient(MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    
    await client.connect();
    console.log('DB: Conexión a MongoDB establecida');
    
    db = client.db(DB_NAME);
    conversations = db.collection(COLLECTION_NAME);
    
    // Crear índices para mejor rendimiento
    await conversations.createIndex({ id: 1 }, { unique: true });
    await conversations.createIndex({ lastActive: -1 });
    await conversations.createIndex({ created_at: -1 });
    await conversations.createIndex({ title: "text", "messages.content": "text" });
    
    console.log('DB: Índices creados correctamente');
    
    // Crear backup automático diario (si hay datos)
    await createBackupIfNeeded();
    
    return true;
  } catch (error) {
    console.error('DB: Error al inicializar la base de datos:', error);
    throw new Error('Error al inicializar la base de datos: ' + error.message);
  }
}

/**
 * Guarda una conversación
 * @param {Object} conversation - Objeto de conversación a guardar
 * @returns {Promise<Object>} La conversación guardada
 */
async function saveConversation(conversation) {
  try {
    if (!conversation || !conversation.id) {
      throw new Error('Conversación inválida: falta ID');
    }
    
    // Validar estructura de la conversación
    const validation = validateConversation(conversation);
    if (!validation.valid) {
      throw new Error(`Conversación inválida: ${validation.errors.join(', ')}`);
    }
    
    // Añadir o actualizar timestamp de última modificación
    conversation.lastUpdated = new Date().toISOString();
    
    // Opcionalmente encriptar contenido sensible (mensajes)
    if (process.env.ENCRYPTION_KEY && conversation.messages) {
      conversation.messages = encryptData(conversation.messages);
    }
    
    // Guardar en MongoDB con upsert
    await conversations.updateOne(
      { id: conversation.id },
      { $set: conversation },
      { upsert: true }
    );
    
    // Si los mensajes están encriptados, desencriptarlos para el retorno
    if (conversation.messages && conversation.messages.encrypted) {
      conversation.messages = decryptData(conversation.messages);
    }
    
    return conversation;
  } catch (error) {
    console.error(`DB: Error al guardar conversación ${conversation?.id}:`, error);
    throw error;
  }
}

/**
 * Obtiene una conversación específica
 * @param {string} id - ID de la conversación
 * @returns {Promise<Object|null>} Conversación encontrada o null si no existe
 */
async function getConversation(id) {
  try {
    const conversation = await conversations.findOne({ id });
    
    if (!conversation) {
      return null;
    }
    
    // Desencriptar mensajes si están encriptados
    if (conversation.messages && conversation.messages.encrypted) {
      conversation.messages = decryptData(conversation.messages);
    }
    
    return conversation;
  } catch (error) {
    console.error(`DB: Error al obtener conversación ${id}:`, error);
    return null;
  }
}

/**
 * Obtiene todas las conversaciones
 * @param {Object} options - Opciones de filtrado y ordenamiento
 * @param {Object} options.filter - Filtros a aplicar
 * @param {string} options.filter.title - Filtrar por título
 * @param {Object} options.filter.dateRange - Rango de fechas
 * @param {string} options.sortBy - Campo para ordenar
 * @param {string} options.sortDirection - Dirección de ordenamiento ('asc' o 'desc')
 * @param {number} options.page - Número de página (para paginación)
 * @param {number} options.limit - Límite de resultados por página
 * @returns {Promise<Array>} Lista de conversaciones
 */
async function getAllConversations(options = {}) {
  try {
    // Construir el filtro para MongoDB
    const filter = {};
    
    if (options.filter) {
      if (options.filter.title) {
        filter.title = { $regex: options.filter.title, $options: 'i' };
      }
      
      if (options.filter.dateRange) {
        const dateField = 'lastActive';
        filter[dateField] = {};
        
        if (options.filter.dateRange.start) {
          filter[dateField].$gte = new Date(options.filter.dateRange.start).toISOString();
        }
        
        if (options.filter.dateRange.end) {
          filter[dateField].$lte = new Date(options.filter.dateRange.end).toISOString();
        }
      }
    }
    
    // Definir ordenamiento
    const sortField = options.sortBy || 'lastActive';
    const sortDirection = options.sortDirection === 'asc' ? 1 : -1;
    const sort = { [sortField]: sortDirection };
    
    // Configurar paginación
    const page = options.page || 1;
    const limit = options.limit || 100;
    const skip = (page - 1) * limit;
    
    // Ejecutar consulta con paginación
    const cursor = conversations
      .find(filter)
      .sort(sort)
      .skip(skip)
      .limit(limit);
    
    const results = await cursor.toArray();
    
    // Desencriptar mensajes si es necesario
    for (const conv of results) {
      if (conv.messages && conv.messages.encrypted) {
        conv.messages = decryptData(conv.messages);
      }
    }
    
    // Obtener total de resultados para metadatos de paginación
    const total = await conversations.countDocuments(filter);
    
    return {
      data: results,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit)
      }
    };
  } catch (error) {
    console.error('DB: Error al obtener todas las conversaciones:', error);
    return { data: [], pagination: { total: 0, page: 1, limit: 100, pages: 0 } };
  }
}

/**
 * Elimina una conversación
 * @param {string} id - ID de la conversación
 * @param {Object} options - Opciones adicionales
 * @param {boolean} options.createBackup - Si se debe crear backup antes de eliminar
 * @returns {Promise<boolean>} True si se eliminó correctamente
 */
async function deleteConversation(id, options = { createBackup: true }) {
  try {
    // Obtener conversación antes de eliminar (para backup)
    if (options.createBackup) {
      const conversation = await getConversation(id);
      if (conversation) {
        const backupPath = path.join(BACKUP_DIR, `${id}_${Date.now()}.json.gz`);
        const data = JSON.stringify(conversation);
        const compressed = await gzip(data);
        await fs.writeFile(backupPath, compressed);
      }
    }
    
    // Eliminar de MongoDB
    const result = await conversations.deleteOne({ id });
    return result.deletedCount > 0;
  } catch (error) {
    console.error(`DB: Error al eliminar conversación ${id}:`, error);
    return false;
  }
}

/**
 * Busca conversaciones por contenido
 * @param {string} searchTerm - Término de búsqueda
 * @param {Object} options - Opciones adicionales (paginación, etc.)
 * @returns {Promise<Array>} Conversaciones que coinciden con la búsqueda
 */
async function searchConversations(searchTerm, options = {}) {
  try {
    if (!searchTerm || searchTerm.trim() === '') {
      return { data: [], pagination: { total: 0, page: 1, limit: 10, pages: 0 } };
    }
    
    const page = options.page || 1;
    const limit = options.limit || 10;
    const skip = (page - 1) * limit;
    
    // Utilizar el índice de texto para búsqueda
    const results = await conversations
      .find(
        { $text: { $search: searchTerm } },
        { score: { $meta: "textScore" } }
      )
      .sort({ score: { $meta: "textScore" } })
      .skip(skip)
      .limit(limit)
      .toArray();
    
    // Contar resultados totales para paginación
    const total = await conversations.countDocuments({ $text: { $search: searchTerm } });
    
    // Procesar resultados y encontrar snippets
    const processedResults = await Promise.all(results.map(async (conv) => {
      // Desencriptar mensajes si están encriptados
      let messages = conv.messages;
      if (messages && messages.encrypted) {
        messages = decryptData(messages);
      }
      
      return {
        id: conv.id,
        title: conv.title,
        created_at: conv.created_at,
        lastActive: conv.lastActive,
        messageCount: messages ? (Array.isArray(messages) ? messages.length : 0) : 0,
        snippet: _findSnippet(messages, searchTerm.toLowerCase())
      };
    }));
    
    return {
      data: processedResults,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit)
      }
    };
  } catch (error) {
    console.error('DB: Error al buscar conversaciones:', error);
    return { data: [], pagination: { total: 0, page: 1, limit: 10, pages: 0 } };
  }
}

/**
 * Encuentra un fragmento de texto que contiene el término de búsqueda
 * @param {Array} messages - Mensajes de la conversación
 * @param {string} term - Término de búsqueda
 * @returns {string} Fragmento encontrado
 * @private
 */
function _findSnippet(messages, term) {
  if (!messages || !Array.isArray(messages)) {
    return '';
  }
  
  for (const msg of messages) {
    if (msg.content && msg.content.toLowerCase().includes(term)) {
      const index = msg.content.toLowerCase().indexOf(term);
      const start = Math.max(0, index - 30);
      const end = Math.min(msg.content.length, index + term.length + 30);
      
      let snippet = msg.content.substring(start, end);
      if (start > 0) snippet = '...' + snippet;
      if (end < msg.content.length) snippet = snippet + '...';
      
      return snippet;
    }
  }
  
  return '';
}

/**
 * Crea una copia de seguridad de todos los datos
 * @param {Object} options - Opciones de backup
 * @param {boolean} options.compress - Si se debe comprimir el backup
 * @returns {Promise<string>} Ruta del archivo de backup
 */
async function createBackup(options = { compress: true }) {
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileExt = options.compress ? '.json.gz' : '.json';
    const backupFile = path.join(BACKUP_DIR, `backup_${timestamp}${fileExt}`);
    
    // Obtener todas las conversaciones
    const result = await getAllConversations({ limit: 10000 });
    const conversations = result.data;
    
    // Desencriptar mensajes para el backup
    for (const conv of conversations) {
      if (conv.messages && conv.messages.encrypted) {
        conv.messages = decryptData(conv.messages);
      }
    }
    
    const data = JSON.stringify(conversations, null, 2);
    
    if (options.compress) {
      const compressed = await gzip(data);
      await fs.writeFile(backupFile, compressed);
    } else {
      await fs.writeFile(backupFile, data, 'utf8');
    }
    
    console.log(`DB: Backup creado en ${backupFile}`);
    return backupFile;
  } catch (error) {
    console.error('DB: Error al crear backup:', error);
    throw error;
  }
}

/**
 * Restaura datos desde una copia de seguridad
 * @param {string} backupPath - Ruta al archivo de backup
 * @returns {Promise<number>} Número de conversaciones restauradas
 */
async function restoreFromBackup(backupPath) {
  try {
    // Verificar que el archivo existe
    await fs.access(backupPath);
    
    // Leer archivo y descomprimir si es necesario
    let data = await fs.readFile(backupPath);
    
    if (backupPath.endsWith('.gz')) {
      data = await gunzip(data);
    }
    
    const backupData = JSON.parse(data.toString('utf8'));
    
    // Contar conversaciones restauradas
    let restoredCount = 0;
    
    // Usar operaciones en lote para mejor rendimiento
    const bulkOps = [];
    
    for (const conversation of backupData) {
      if (conversation && conversation.id) {
        // Encriptar mensajes si es necesario
        if (process.env.ENCRYPTION_KEY && conversation.messages) {
          conversation.messages = encryptData(conversation.messages);
        }
        
        bulkOps.push({
          updateOne: {
            filter: { id: conversation.id },
            update: { $set: conversation },
            upsert: true
          }
        });
        
        restoredCount++;
      }
    }
    
    if (bulkOps.length > 0) {
      await conversations.bulkWrite(bulkOps);
    }
    
    console.log(`DB: ${restoredCount} conversaciones restauradas desde ${backupPath}`);
    return restoredCount;
  } catch (error) {
    console.error(`DB: Error al restaurar desde backup ${backupPath}:`, error);
    throw error;
  }
}

/**
 * Crea un backup si no se ha creado recientemente
 * @private
 */
async function createBackupIfNeeded() {
  try {
    // Verificar si hay conversaciones para respaldar
    const count = await conversations.countDocuments({});
    
    if (count === 0) {
      return; // No hay nada que respaldar
    }
    
    // Verificar si ya existe un backup reciente (último día)
    const backupFiles = await fs.readdir(BACKUP_DIR);
    const filteredFiles = backupFiles
      .filter(file => file.startsWith('backup_'))
      .sort();
    
    if (filteredFiles.length > 0) {
      const lastBackup = filteredFiles[filteredFiles.length - 1];
      const backupPath = path.join(BACKUP_DIR, lastBackup);
      const backupStats = await fs.stat(backupPath);
      
      // Si el último backup es de hace menos de 24 horas, no crear otro
      const now = new Date();
      const backupDate = new Date(backupStats.mtime);
      const hoursSinceLastBackup = (now - backupDate) / (1000 * 60 * 60);
      
      if (hoursSinceLastBackup < 24) {
        return;
      }
    }
    
    // Crear nuevo backup
    await createBackup();
    
    // Eliminar backups antiguos (mantener solo los últimos 7)
    const maxBackups = 7;
    const backupFiles2 = await fs.readdir(BACKUP_DIR);
    const filteredFiles2 = backupFiles2
      .filter(file => file.startsWith('backup_'))
      .sort();
    
    if (filteredFiles2.length > maxBackups) {
      for (let i = 0; i < filteredFiles2.length - maxBackups; i++) {
        await fs.unlink(path.join(BACKUP_DIR, filteredFiles2[i]));
      }
    }
  } catch (error) {
    console.error('DB: Error al gestionar backups automáticos:', error);
  }
}

/**
 * Elimina conversaciones antiguas para liberar espacio
 * @param {number} daysOld - Días de antigüedad para considerar eliminación
 * @param {boolean} createBackupFirst - Si se debe crear backup antes de eliminar
 * @returns {Promise<number>} Número de conversaciones eliminadas
 */
async function pruneOldConversations(daysOld = 90, createBackupFirst = true) {
  try {
    if (createBackupFirst) {
      await createBackup();
    }
    
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);
    const cutoffISOString = cutoffDate.toISOString();
    
    // Búsqueda más eficiente usando índices
    const result = await conversations.deleteMany({
      $or: [
        { lastActive: { $lt: cutoffISOString } },
        { 
          lastActive: { $exists: false }, 
          created_at: { $lt: cutoffISOString } 
        }
      ]
    });
    
    const count = result.deletedCount;
    console.log(`DB: Se eliminaron ${count} conversaciones antiguas`);
    return count;
  } catch (error) {
    console.error('DB: Error al eliminar conversaciones antiguas:', error);
    return 0;
  }
}

/**
 * Cierra la conexión a la base de datos
 * @returns {Promise<void>}
 */
async function close() {
  if (client) {
    await client.close();
    console.log('DB: Conexión a MongoDB cerrada');
  }
}

// Sistema de métricas para monitoreo
const metrics = {
  operations: {
    read: 0,
    write: 0,
    delete: 0,
    search: 0
  },
  errors: 0,
  lastError: null,
  
  // Método para obtener métricas
  getMetrics() {
    return { ...this.operations, errors: this.errors };
  },
  
  // Método para resetear métricas
  resetMetrics() {
    this.operations.read = 0;
    this.operations.write = 0;
    this.operations.delete = 0;
    this.operations.search = 0;
    this.errors = 0;
    this.lastError = null;
  }
};

// Exportar la API pública del módulo
module.exports = {
  init,
  saveConversation,
  getConversation,
  getAllConversations,
  deleteConversation,
  searchConversations,
  createBackup,
  restoreFromBackup,
  pruneOldConversations,
  close,
  getMetrics: metrics.getMetrics.bind(metrics),
  resetMetrics: metrics.resetMetrics.bind(metrics)
};
