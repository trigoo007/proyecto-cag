/**
 * Módulo de base de datos para la aplicación CAG
 * Implementa almacenamiento basado en archivos para las conversaciones
 */

const fs = require('fs');
const path = require('path');

// Directorio para almacenar los datos
const DATA_DIR = path.join(__dirname, 'data');
const CONVERSATIONS_DIR = path.join(DATA_DIR, 'conversations');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');

// Crear directorios si no existen
function init() {
    try {
        const dirs = [DATA_DIR, CONVERSATIONS_DIR, BACKUP_DIR];
        
        dirs.forEach(dir => {
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
                console.log(`DB: Directorio creado - ${dir}`);
            }
        });
        
        // Verificar acceso de escritura
        const testPath = path.join(CONVERSATIONS_DIR, '.test');
        fs.writeFileSync(testPath, 'test');
        fs.unlinkSync(testPath);
        
        console.log('DB: Sistema de base de datos inicializado correctamente');
        
        // Crear backup automático diario (si hay datos)
        createBackupIfNeeded();
        
        return true;
    } catch (error) {
        console.error('DB: Error al inicializar la base de datos:', error);
        throw new Error('Error al inicializar la base de datos: ' + error.message);
    }
}

/**
 * Guarda una conversación
 * @param {Object} conversation - Objeto de conversación a guardar
 * @returns {Object} La conversación guardada
 */
function saveConversation(conversation) {
    try {
        if (!conversation || !conversation.id) {
            throw new Error('Conversación inválida: falta ID');
        }
        
        // Añadir o actualizar timestamp de última modificación
        conversation.lastUpdated = new Date().toISOString();
        
        const filePath = path.join(CONVERSATIONS_DIR, `${conversation.id}.json`);
        fs.writeFileSync(filePath, JSON.stringify(conversation, null, 2), 'utf8');
        
        return conversation;
    } catch (error) {
        console.error(`DB: Error al guardar conversación ${conversation?.id}:`, error);
        throw error;
    }
}

/**
 * Obtiene una conversación específica
 * @param {string} id - ID de la conversación
 * @returns {Object|null} Conversación encontrada o null si no existe
 */
function getConversation(id) {
    try {
        const filePath = path.join(CONVERSATIONS_DIR, `${id}.json`);
        if (!fs.existsSync(filePath)) {
            return null;
        }
        
        const data = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error(`DB: Error al obtener conversación ${id}:`, error);
        return null;
    }
}

/**
 * Obtiene todas las conversaciones
 * @param {Object} options - Opciones de filtrado y ordenamiento
 * @returns {Array} Lista de conversaciones
 */
function getAllConversations(options = {}) {
    try {
        const files = fs.readdirSync(CONVERSATIONS_DIR);
        
        const conversations = files
            .filter(file => file.endsWith('.json'))
            .map(file => {
                try {
                    const filePath = path.join(CONVERSATIONS_DIR, file);
                    const data = fs.readFileSync(filePath, 'utf8');
                    return JSON.parse(data);
                } catch (err) {
                    console.error(`DB: Error al leer el archivo ${file}:`, err);
                    return null;
                }
            })
            .filter(conv => conv !== null);
        
        // Aplicar filtrado si se especifica
        let filtered = [...conversations];
        
        if (options.filter) {
            if (options.filter.title) {
                const titleLower = options.filter.title.toLowerCase();
                filtered = filtered.filter(conv => 
                    conv.title && conv.title.toLowerCase().includes(titleLower)
                );
            }
            
            if (options.filter.dateRange) {
                const { start, end } = options.filter.dateRange;
                filtered = filtered.filter(conv => {
                    const date = new Date(conv.lastActive || conv.created_at);
                    return (!start || date >= new Date(start)) && 
                           (!end || date <= new Date(end));
                });
            }
        }
        
        // Ordenar (por defecto, más reciente primero)
        const sortField = options.sortBy || 'lastActive';
        const sortDirection = options.sortDirection === 'asc' ? 1 : -1;
        
        filtered.sort((a, b) => {
            const dateA = new Date(a[sortField] || a.created_at);
            const dateB = new Date(b[sortField] || b.created_at);
            return sortDirection * (dateB - dateA);
        });
        
        return filtered;
    } catch (error) {
        console.error('DB: Error al obtener todas las conversaciones:', error);
        return [];
    }
}

/**
 * Elimina una conversación
 * @param {string} id - ID de la conversación
 * @returns {boolean} True si se eliminó correctamente
 */
function deleteConversation(id) {
    try {
        const filePath = path.join(CONVERSATIONS_DIR, `${id}.json`);
        if (fs.existsSync(filePath)) {
            // Opcionalmente, crear un backup antes de eliminar
            const conversation = getConversation(id);
            if (conversation) {
                const backupPath = path.join(BACKUP_DIR, `${id}_${Date.now()}.json`);
                fs.writeFileSync(backupPath, JSON.stringify(conversation, null, 2), 'utf8');
            }
            
            fs.unlinkSync(filePath);
            return true;
        }
        return false;
    } catch (error) {
        console.error(`DB: Error al eliminar conversación ${id}:`, error);
        return false;
    }
}

/**
 * Busca conversaciones por contenido
 * @param {string} searchTerm - Término de búsqueda
 * @returns {Array} Conversaciones que coinciden con la búsqueda
 */
function searchConversations(searchTerm) {
    try {
        if (!searchTerm || searchTerm.trim() === '') {
            return [];
        }
        
        const term = searchTerm.toLowerCase();
        const conversations = getAllConversations();
        
        return conversations.filter(conv => {
            // Buscar en el título
            if (conv.title && conv.title.toLowerCase().includes(term)) {
                return true;
            }
            
            // Buscar en los mensajes
            if (conv.messages && Array.isArray(conv.messages)) {
                return conv.messages.some(msg => 
                    msg.content && msg.content.toLowerCase().includes(term)
                );
            }
            
            return false;
        }).map(conv => ({
            id: conv.id,
            title: conv.title,
            created_at: conv.created_at,
            lastActive: conv.lastActive,
            messageCount: conv.messages ? conv.messages.length : 0,
            snippet: this._findSnippet(conv.messages, term)
        }));
    } catch (error) {
        console.error('DB: Error al buscar conversaciones:', error);
        return [];
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
 * @returns {string} Ruta del archivo de backup
 */
function createBackup() {
    try {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupFile = path.join(BACKUP_DIR, `backup_${timestamp}.json`);
        
        const conversations = getAllConversations();
        fs.writeFileSync(backupFile, JSON.stringify(conversations, null, 2), 'utf8');
        
        console.log(`DB: Backup creado en ${backupFile}`);
        return backupFile;
    } catch (error) {
        console.error('DB: Error al crear backup:', error);
        throw error;
    }
}

/**
 * Crea un backup si no se ha creado recientemente
 * @private
 */
function createBackupIfNeeded() {
    try {
        // Verificar si hay conversaciones para respaldar
        const files = fs.readdirSync(CONVERSATIONS_DIR);
        const conversationFiles = files.filter(file => file.endsWith('.json'));
        
        if (conversationFiles.length === 0) {
            return; // No hay nada que respaldar
        }
        
        // Verificar si ya existe un backup reciente (último día)
        const backupFiles = fs.readdirSync(BACKUP_DIR)
            .filter(file => file.startsWith('backup_'))
            .sort();
        
        if (backupFiles.length > 0) {
            const lastBackup = backupFiles[backupFiles.length - 1];
            const backupPath = path.join(BACKUP_DIR, lastBackup);
            const backupStats = fs.statSync(backupPath);
            
            // Si el último backup es de hace menos de 24 horas, no crear otro
            const now = new Date();
            const backupDate = new Date(backupStats.mtime);
            const hoursSinceLastBackup = (now - backupDate) / (1000 * 60 * 60);
            
            if (hoursSinceLastBackup < 24) {
                return;
            }
        }
        
        // Crear nuevo backup
        createBackup();
        
        // Eliminar backups antiguos (mantener solo los últimos 7)
        const maxBackups = 7;
        const backupFiles2 = fs.readdirSync(BACKUP_DIR)
            .filter(file => file.startsWith('backup_'))
            .sort();
        
        if (backupFiles2.length > maxBackups) {
            for (let i = 0; i < backupFiles2.length - maxBackups; i++) {
                fs.unlinkSync(path.join(BACKUP_DIR, backupFiles2[i]));
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
 * @returns {number} Número de conversaciones eliminadas
 */
function pruneOldConversations(daysOld = 90, createBackupFirst = true) {
    try {
        if (createBackupFirst) {
            createBackup();
        }
        
        const conversations = getAllConversations();
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - daysOld);
        
        let count = 0;
        
        conversations.forEach(conv => {
            const lastActive = new Date(conv.lastActive || conv.created_at);
            if (lastActive < cutoffDate) {
                if (deleteConversation(conv.id)) {
                    count++;
                }
            }
        });
        
        console.log(`DB: Se eliminaron ${count} conversaciones antiguas`);
        return count;
    } catch (error) {
        console.error('DB: Error al eliminar conversaciones antiguas:', error);
        return 0;
    }
}

module.exports = {
    init,
    saveConversation,
    getConversation,
    getAllConversations,
    deleteConversation,
    searchConversations,
    createBackup,
    pruneOldConversations
};