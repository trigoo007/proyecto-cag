/**
 * Almacén de Memoria para CAG
 * 
 * Este módulo maneja el almacenamiento y recuperación de memoria a corto y largo plazo
 * para las conversaciones, permitiendo que el sistema recuerde contexto relevante.
 */

const fs = require('fs');
const path = require('path');

// Directorios para almacenamiento de memoria
const DATA_DIR = path.join(__dirname, 'data');
const MEMORY_DIR = path.join(DATA_DIR, 'memory');
const SHORT_TERM_MEMORY_DIR = path.join(MEMORY_DIR, 'short_term');
const LONG_TERM_MEMORY_DIR = path.join(MEMORY_DIR, 'long_term');

// Configuración de memoria
const MAX_SHORT_TERM_ITEMS = 25;     // Máximo de ítems en memoria a corto plazo
const MAX_LONG_TERM_ITEMS = 100;     // Máximo de ítems en memoria a largo plazo
const MEMORY_DECAY_FACTOR = 0.95;    // Factor de decaimiento por tiempo
const RELEVANCE_THRESHOLD = 0.2;     // Umbral mínimo de relevancia para recordar

/**
 * Inicializa el almacén de memoria
 */
function init() {
    try {
        // Crear directorios si no existen
        const dirs = [MEMORY_DIR, SHORT_TERM_MEMORY_DIR, LONG_TERM_MEMORY_DIR];
        
        dirs.forEach(dir => {
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
                console.log(`MemoryStore: Directorio creado - ${dir}`);
            }
        });
        
        console.log('MemoryStore: Inicializado correctamente');
        
        // Programar limpieza periódica de memoria
        scheduleMemoryMaintenance();
    } catch (error) {
        console.error('MemoryStore: Error de inicialización:', error);
    }
}

/**
 * Actualiza la memoria con nueva información
 * @param {string} conversationId - ID de la conversación
 * @param {string} userId - ID del usuario (opcional)
 * @param {Object} memoryItem - Ítem de memoria a guardar
 * @returns {Promise<Object>} Memoria actualizada
 */
async function updateMemory(conversationId, userId, memoryItem) {
    try {
        if (!conversationId || !memoryItem) {
            console.warn('MemoryStore: ID de conversación o ítem de memoria faltante');
            return null;
        }
        
        // Obtener memoria actual
        const memory = await getMemory(conversationId, userId);
        
        // Calcular relevancia del ítem de memoria
        const relevance = calculateRelevance(memoryItem);
        
        // Añadir metadatos al ítem
        const enhancedItem = {
            ...memoryItem,
            timestamp: memoryItem.timestamp || new Date().toISOString(),
            relevance,
            accessCount: 1,
            lastAccessed: new Date().toISOString()
        };
        
        // Añadir a memoria a corto plazo
        memory.shortTerm = [enhancedItem, ...memory.shortTerm];
        
        // Limitar tamaño de memoria a corto plazo
        if (memory.shortTerm.length > MAX_SHORT_TERM_ITEMS) {
            // Mover ítems más antiguos a memoria a largo plazo si son relevantes
            const itemsToMove = memory.shortTerm.splice(MAX_SHORT_TERM_ITEMS);
            
            itemsToMove.forEach(item => {
                if (item.relevance >= RELEVANCE_THRESHOLD) {
                    memory.longTerm.push(item);
                }
            });
        }
        
        // Limitar tamaño de memoria a largo plazo (conservar los más relevantes)
        if (memory.longTerm.length > MAX_LONG_TERM_ITEMS) {
            memory.longTerm = memory.longTerm
                .sort((a, b) => b.relevance - a.relevance)
                .slice(0, MAX_LONG_TERM_ITEMS);
        }
        
        // Actualizar metadatos de la memoria
        memory.lastUpdated = new Date().toISOString();
        memory.itemCount = memory.shortTerm.length + memory.longTerm.length;
        
        // Guardar memoria
        await saveMemory(conversationId, userId, memory);
        
        return memory;
    } catch (error) {
        console.error(`MemoryStore: Error al actualizar memoria para ${conversationId}:`, error);
        return null;
    }
}

/**
 * Obtiene la memoria de una conversación
 * @param {string} conversationId - ID de la conversación
 * @param {string} userId - ID del usuario (opcional)
 * @returns {Promise<Object>} Memoria de la conversación
 */
async function getMemory(conversationId, userId) {
    try {
        if (!conversationId) {
            console.warn('MemoryStore: ID de conversación faltante');
            return createEmptyMemory();
        }
        
        // Construir ruta de archivo
        const shortTermPath = path.join(SHORT_TERM_MEMORY_DIR, `${conversationId}.json`);
        const longTermPath = path.join(LONG_TERM_MEMORY_DIR, `${conversationId}.json`);
        
        let shortTermMemory = [];
        let longTermMemory = [];
        
        // Cargar memoria a corto plazo
        if (fs.existsSync(shortTermPath)) {
            try {
                const data = fs.readFileSync(shortTermPath, 'utf8');
                shortTermMemory = JSON.parse(data);
                
                // Actualizar contador de acceso y timestamp
                shortTermMemory = shortTermMemory.map(item => ({
                    ...item,
                    accessCount: (item.accessCount || 0) + 1,
                    lastAccessed: new Date().toISOString()
                }));
            } catch (err) {
                console.error(`MemoryStore: Error al leer memoria a corto plazo para ${conversationId}:`, err);
                shortTermMemory = [];
            }
        }
        
        // Cargar memoria a largo plazo
        if (fs.existsSync(longTermPath)) {
            try {
                const data = fs.readFileSync(longTermPath, 'utf8');
                longTermMemory = JSON.parse(data);
                
                // Aplicar decaimiento por tiempo a la relevancia
                longTermMemory = longTermMemory.map(item => {
                    // Calcular tiempo transcurrido en días
                    const itemDate = new Date(item.timestamp);
                    const now = new Date();
                    const daysPassed = (now - itemDate) / (1000 * 60 * 60 * 24);
                    
                    // Aplicar decaimiento exponencial
                    const decayedRelevance = item.relevance * Math.pow(MEMORY_DECAY_FACTOR, daysPassed);
                    
                    return {
                        ...item,
                        relevance: decayedRelevance,
                        accessCount: (item.accessCount || 0) + 1,
                        lastAccessed: new Date().toISOString()
                    };
                });
                
                // Filtrar ítems que caen por debajo del umbral
                longTermMemory = longTermMemory.filter(item => 
                    item.relevance >= RELEVANCE_THRESHOLD
                );
            } catch (err) {
                console.error(`MemoryStore: Error al leer memoria a largo plazo para ${conversationId}:`, err);
                longTermMemory = [];
            }
        }
        
        // Construir objeto de memoria
        const memory = {
            conversationId,
            userId: userId || null,
            shortTerm: shortTermMemory,
            longTerm: longTermMemory,
            lastAccessed: new Date().toISOString(),
            itemCount: shortTermMemory.length + longTermMemory.length
        };
        
        // Guardar con contadores actualizados
        await saveMemory(conversationId, userId, memory);
        
        return memory;
    } catch (error) {
        console.error(`MemoryStore: Error al obtener memoria para ${conversationId}:`, error);
        return createEmptyMemory(conversationId, userId);
    }
}

/**
 * Guarda la memoria de una conversación
 * @param {string} conversationId - ID de la conversación
 * @param {string} userId - ID del usuario (opcional)
 * @param {Object} memory - Memoria a guardar
 * @private
 */
async function saveMemory(conversationId, userId, memory) {
    try {
        if (!conversationId || !memory) {
            console.warn('MemoryStore: ID de conversación o memoria faltante');
            return;
        }
        
        // Construir rutas de archivo
        const shortTermPath = path.join(SHORT_TERM_MEMORY_DIR, `${conversationId}.json`);
        const longTermPath = path.join(LONG_TERM_MEMORY_DIR, `${conversationId}.json`);
        
        // Guardar memoria a corto plazo
        fs.writeFileSync(shortTermPath, JSON.stringify(memory.shortTerm, null, 2), 'utf8');
        
        // Guardar memoria a largo plazo
        fs.writeFileSync(longTermPath, JSON.stringify(memory.longTerm, null, 2), 'utf8');
    } catch (error) {
        console.error(`MemoryStore: Error al guardar memoria para ${conversationId}:`, error);
    }
}

/**
 * Crea un objeto de memoria vacío
 * @param {string} conversationId - ID de la conversación
 * @param {string} userId - ID del usuario (opcional)
 * @returns {Object} Objeto de memoria vacío
 * @private
 */
function createEmptyMemory(conversationId = null, userId = null) {
    return {
        conversationId,
        userId,
        shortTerm: [],
        longTerm: [],
        lastAccessed: new Date().toISOString(),
        itemCount: 0
    };
}

/**
 * Calcula la relevancia de un ítem de memoria
 * @param {Object} memoryItem - Ítem de memoria
 * @returns {number} Puntuación de relevancia (0-1)
 * @private
 */
function calculateRelevance(memoryItem) {
    try {
        // Base de relevancia
        let relevance = 0.5;
        
        // Factores que incrementan relevancia
        
        // 1. Entidades - más entidades = más relevante
        if (memoryItem.entities && Array.isArray(memoryItem.entities)) {
            const entityCount = memoryItem.entities.length;
            relevance += Math.min(0.3, entityCount * 0.05);
        }
        
        // 2. Sentimiento - mensajes con sentimiento fuerte son más memorables
        if (memoryItem.sentiment) {
            if (memoryItem.sentiment.intensity > 0.5) {
                relevance += 0.1;
            }
            
            // Sentimientos extremos (muy positivos o muy negativos) son más memorables
            if (memoryItem.sentiment.sentiment === 'positive' && memoryItem.sentiment.score > 0.7) {
                relevance += 0.1;
            } else if (memoryItem.sentiment.sentiment === 'negative' && memoryItem.sentiment.score < -0.7) {
                relevance += 0.15;
            }
            
            // El sentimiento de urgencia o confusión aumenta relevancia
            if (memoryItem.sentiment.sentiment === 'urgent' || memoryItem.sentiment.sentiment === 'confused') {
                relevance += 0.2;
            }
        }
        
        // 3. Temas - mensajes con temas claros son más relevantes
        if (memoryItem.topics && Array.isArray(memoryItem.topics) && memoryItem.topics.length > 0) {
            // Temas con alta confianza
            const highConfidenceTopics = memoryItem.topics.filter(t => t.confidence > 0.7).length;
            relevance += Math.min(0.2, highConfidenceTopics * 0.05);
        }
        
        // 4. Contenido del mensaje - longitud y complejidad
        if (memoryItem.userMessage) {
            const wordCount = memoryItem.userMessage.split(/\s+/).length;
            if (wordCount > 50) {
                relevance += 0.15; // Mensajes largos tienden a ser más importantes
            }
        }
        
        // Limitar a rango válido
        return Math.max(0, Math.min(1, relevance));
    } catch (error) {
        console.error('MemoryStore: Error al calcular relevancia:', error);
        return 0.5; // Valor por defecto
    }
}

/**
 * Busca en la memoria información relevante a una consulta
 * @param {string} conversationId - ID de la conversación
 * @param {string} query - Consulta para buscar
 * @param {Object} options - Opciones de búsqueda
 * @returns {Promise<Array>} Ítems de memoria relevantes
 */
async function searchMemory(conversationId, query, options = {}) {
    try {
        if (!conversationId || !query) {
            return [];
        }
        
        // Obtener memoria completa
        const memory = await getMemory(conversationId);
        
        // Combinar memoria a corto y largo plazo
        const allMemoryItems = [...memory.shortTerm, ...memory.longTerm];
        
        // Preparar la búsqueda
        const queryTerms = query.toLowerCase().split(/\W+/).filter(term => term.length > 3);
        
        if (queryTerms.length === 0) {
            return [];
        }
        
        // Buscar coincidencias
        const results = allMemoryItems.map(item => {
            let score = 0;
            let matchFields = [];
            
            // Buscar en mensaje del usuario
            if (item.userMessage) {
                const userMessageLower = item.userMessage.toLowerCase();
                const userMatches = queryTerms.filter(term => userMessageLower.includes(term)).length;
                
                if (userMatches > 0) {
                    score += userMatches / queryTerms.length * 0.6;
                    matchFields.push('userMessage');
                }
            }
            
            // Buscar en respuesta del bot
            if (item.botResponse) {
                const botResponseLower = item.botResponse.toLowerCase();
                const botMatches = queryTerms.filter(term => botResponseLower.includes(term)).length;
                
                if (botMatches > 0) {
                    score += botMatches / queryTerms.length * 0.4;
                    matchFields.push('botResponse');
                }
            }
            
            // Buscar en entidades
            if (item.entities && Array.isArray(item.entities)) {
                const entityMatches = item.entities.filter(entity => 
                    queryTerms.some(term => entity.name.toLowerCase().includes(term))
                ).length;
                
                if (entityMatches > 0) {
                    score += entityMatches * 0.2;
                    matchFields.push('entities');
                }
            }
            
            // Incluir relevancia del ítem en la puntuación final
            score *= (item.relevance || 0.5);
            
            return {
                ...item,
                searchScore: score,
                matchFields
            };
        });
        
        // Filtrar por puntuación mínima y ordenar por relevancia
        return results
            .filter(item => item.searchScore > 0.1)
            .sort((a, b) => b.searchScore - a.searchScore);
    } catch (error) {
        console.error(`MemoryStore: Error al buscar en memoria para ${conversationId}:`, error);
        return [];
    }
}

/**
 * Elimina la memoria de una conversación
 * @param {string} conversationId - ID de la conversación
 * @returns {Promise<boolean>} True si se eliminó correctamente
 */
async function deleteMemory(conversationId) {
    try {
        if (!conversationId) {
            return false;
        }
        
        // Construir rutas de archivo
        const shortTermPath = path.join(SHORT_TERM_MEMORY_DIR, `${conversationId}.json`);
        const longTermPath = path.join(LONG_TERM_MEMORY_DIR, `${conversationId}.json`);
        
        // Eliminar archivos si existen
        let deleted = false;
        
        if (fs.existsSync(shortTermPath)) {
            fs.unlinkSync(shortTermPath);
            deleted = true;
        }
        
        if (fs.existsSync(longTermPath)) {
            fs.unlinkSync(longTermPath);
            deleted = true;
        }
        
        return deleted;
    } catch (error) {
        console.error(`MemoryStore: Error al eliminar memoria para ${conversationId}:`, error);
        return false;
    }
}

/**
 * Programa tareas de mantenimiento periódicas
 * @private
 */
function scheduleMemoryMaintenance() {
    // Programar limpieza diaria (cada 24 horas)
    setInterval(() => {
        try {
            console.log('MemoryStore: Iniciando mantenimiento de memoria');
            
            // Limpiar memoria antigua
            cleanOldMemory();
            
            // Compactar memoria de largo plazo
            compactLongTermMemory();
        } catch (error) {
            console.error('MemoryStore: Error en mantenimiento de memoria:', error);
        }
    }, 24 * 60 * 60 * 1000); // 24 horas
}

/**
 * Limpia memoria antigua
 * @private
 */
function cleanOldMemory() {
    try {
        const now = new Date();
        let cleanedCount = 0;
        
        // Procesar archivos de memoria a corto plazo
        if (fs.existsSync(SHORT_TERM_MEMORY_DIR)) {
            const files = fs.readdirSync(SHORT_TERM_MEMORY_DIR);
            
            files.forEach(file => {
                const filePath = path.join(SHORT_TERM_MEMORY_DIR, file);
                const stats = fs.statSync(filePath);
                
                // Obtener edad del archivo en días
                const fileAge = (now - stats.mtime) / (1000 * 60 * 60 * 24);
                
                // Eliminar archivos de más de 30 días
                if (fileAge > 30) {
                    fs.unlinkSync(filePath);
                    cleanedCount++;
                }
            });
        }
        
        console.log(`MemoryStore: Limpiados ${cleanedCount} archivos de memoria antiguos`);
    } catch (error) {
        console.error('MemoryStore: Error al limpiar memoria antigua:', error);
    }
}

/**
 * Compacta la memoria a largo plazo
 * @private
 */
function compactLongTermMemory() {
    try {
        if (fs.existsSync(LONG_TERM_MEMORY_DIR)) {
            const files = fs.readdirSync(LONG_TERM_MEMORY_DIR);
            let compactedCount = 0;
            
            files.forEach(file => {
                try {
                    const filePath = path.join(LONG_TERM_MEMORY_DIR, file);
                    
                    // Leer datos
                    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                    
                    if (Array.isArray(data) && data.length > MAX_LONG_TERM_ITEMS) {
                        // Ordenar por relevancia y limitar tamaño
                        const compactedData = data
                            .sort((a, b) => b.relevance - a.relevance)
                            .slice(0, MAX_LONG_TERM_ITEMS);
                        
                        // Guardar versión compactada
                        fs.writeFileSync(filePath, JSON.stringify(compactedData, null, 2), 'utf8');
                        compactedCount++;
                    }
                } catch (fileError) {
                    console.error(`MemoryStore: Error al procesar archivo ${file}:`, fileError);
                }
            });
            
            console.log(`MemoryStore: Compactados ${compactedCount} archivos de memoria a largo plazo`);
        }
    } catch (error) {
        console.error('MemoryStore: Error al compactar memoria a largo plazo:', error);
    }
}

/**
 * Reinicia toda la memoria del sistema
 * @returns {Promise<Object>} Resultado de la operación
 */
async function resetMemory() {
    try {
        // Crear respaldo antes de reiniciar
        const backupDir = path.join(MEMORY_DIR, 'backups', new Date().toISOString().replace(/:/g, '-'));
        fs.mkdirSync(backupDir, { recursive: true });
        
        // Respaldo de memoria a corto plazo
        if (fs.existsSync(SHORT_TERM_MEMORY_DIR)) {
            const shortTermBackupDir = path.join(backupDir, 'short_term');
            fs.mkdirSync(shortTermBackupDir, { recursive: true });
            
            const files = fs.readdirSync(SHORT_TERM_MEMORY_DIR);
            files.forEach(file => {
                const sourcePath = path.join(SHORT_TERM_MEMORY_DIR, file);
                const destPath = path.join(shortTermBackupDir, file);
                fs.copyFileSync(sourcePath, destPath);
            });
        }
        
        // Respaldo de memoria a largo plazo
        if (fs.existsSync(LONG_TERM_MEMORY_DIR)) {
            const longTermBackupDir = path.join(backupDir, 'long_term');
            fs.mkdirSync(longTermBackupDir, { recursive: true });
            
            const files = fs.readdirSync(LONG_TERM_MEMORY_DIR);
            files.forEach(file => {
                const sourcePath = path.join(LONG_TERM_MEMORY_DIR, file);
                const destPath = path.join(longTermBackupDir, file);
                fs.copyFileSync(sourcePath, destPath);
            });
        }
        
        // Eliminar archivos actuales
        let deletedCount = 0;
        
        if (fs.existsSync(SHORT_TERM_MEMORY_DIR)) {
            const files = fs.readdirSync(SHORT_TERM_MEMORY_DIR);
            files.forEach(file => {
                fs.unlinkSync(path.join(SHORT_TERM_MEMORY_DIR, file));
                deletedCount++;
            });
        }
        
        if (fs.existsSync(LONG_TERM_MEMORY_DIR)) {
            const files = fs.readdirSync(LONG_TERM_MEMORY_DIR);
            files.forEach(file => {
                fs.unlinkSync(path.join(LONG_TERM_MEMORY_DIR, file));
                deletedCount++;
            });
        }
        
        return {
            success: true,
            backupPath: backupDir,
            deletedFiles: deletedCount,
            timestamp: new Date().toISOString()
        };
    } catch (error) {
        console.error('MemoryStore: Error al reiniciar memoria:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Mueve información específica de la memoria a corto plazo a la de largo plazo
 * @param {string} conversationId - ID de la conversación
 * @param {Array<string>} itemIds - IDs de ítems a mover
 * @returns {Promise<boolean>} True si se realizó correctamente
 */
async function promoteToLongTermMemory(conversationId, itemIds) {
    try {
        if (!conversationId || !itemIds || !Array.isArray(itemIds) || itemIds.length === 0) {
            return false;
        }
        
        // Obtener memoria actual
        const memory = await getMemory(conversationId);
        
        // Identificar ítems a promover
        const itemsToPromote = memory.shortTerm.filter(item => 
            item.id && itemIds.includes(item.id)
        );
        
        if (itemsToPromote.length === 0) {
            return false;
        }
        
        // Remover ítems de memoria a corto plazo
        memory.shortTerm = memory.shortTerm.filter(item => 
            !item.id || !itemIds.includes(item.id)
        );
        
        // Añadir a memoria a largo plazo con relevancia incrementada
        memory.longTerm = [
            ...itemsToPromote.map(item => ({
                ...item,
                relevance: Math.min(1.0, (item.relevance || 0.5) + 0.2), // Incrementar relevancia
                promotedAt: new Date().toISOString()
            })),
            ...memory.longTerm
        ];
        
        // Limitar tamaño de memoria a largo plazo
        if (memory.longTerm.length > MAX_LONG_TERM_ITEMS) {
            memory.longTerm = memory.longTerm
                .sort((a, b) => b.relevance - a.relevance)
                .slice(0, MAX_LONG_TERM_ITEMS);
        }
        
        // Guardar memoria actualizada
        await saveMemory(conversationId, memory.userId, memory);
        
        return true;
    } catch (error) {
        console.error(`MemoryStore: Error al promover memoria para ${conversationId}:`, error);
        return false;
    }
}

// Inicializar el módulo
init();

module.exports = {
    getMemory,
    updateMemory,
    searchMemory,
    deleteMemory,
    resetMemory,
    promoteToLongTermMemory
};