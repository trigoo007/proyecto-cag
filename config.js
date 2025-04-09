/**
 * Módulo de configuración para la aplicación CAG
 * Maneja carga y actualización de la configuración
 */

const fs = require('fs');
const path = require('path');

// Ruta al archivo de configuración
const CONFIG_PATH = path.join(__dirname, 'data', 'config.json');

// Configuración por defecto
const DEFAULT_CONFIG = {
    temperature: 0.7,
    max_tokens: 2048,
    system_prompt: 'Eres un asistente amable y útil que responde de forma clara y organizada.',
    response_format: 'markdown',
    model: 'gemma3:27b',
    memory_settings: {
        max_conversation_history: 20,
        cross_conversation_memory: true
    }
};

/**
 * Inicializa la configuración 
 */
function init() {
    const dataDir = path.join(__dirname, 'data');
    
    try {
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
            console.log('Config: Directorio de datos creado');
        }
        
        if (!fs.existsSync(CONFIG_PATH)) {
            fs.writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2), 'utf8');
            console.log('Config: Archivo de configuración creado con valores por defecto');
        } else {
            console.log('Config: Archivo de configuración existente encontrado');
            
            // Verificar que la config existente tenga todos los campos necesarios
            try {
                const existingConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
                const updatedConfig = { ...DEFAULT_CONFIG, ...existingConfig };
                
                // Asegurar que hay nuevos parámetros predeterminados
                let needsUpdate = false;
                for (const key in DEFAULT_CONFIG) {
                    if (existingConfig[key] === undefined) {
                        needsUpdate = true;
                        break;
                    }
                }
                
                if (needsUpdate) {
                    fs.writeFileSync(CONFIG_PATH, JSON.stringify(updatedConfig, null, 2), 'utf8');
                    console.log('Config: Archivo de configuración actualizado con nuevos parámetros');
                }
            } catch (error) {
                console.error('Config: Error al verificar la configuración existente:', error);
                console.log('Config: Restaurando configuración por defecto');
                fs.writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2), 'utf8');
            }
        }
    } catch (error) {
        console.error('Config: Error en inicialización:', error);
        throw new Error('No se pudo inicializar la configuración: ' + error.message);
    }
}

/**
 * Obtiene la configuración actual
 * @returns {Object} La configuración actual
 */
function get() {
    try {
        if (!fs.existsSync(CONFIG_PATH)) {
            console.warn('Config: Archivo de configuración no encontrado, usando valores por defecto');
            return DEFAULT_CONFIG;
        }
        
        const data = fs.readFileSync(CONFIG_PATH, 'utf8');
        const config = JSON.parse(data);
        
        // Verificar valores válidos
        if (typeof config.temperature !== 'number' || config.temperature < 0 || config.temperature > 1) {
            console.warn('Config: Temperatura inválida, ajustando a 0.7');
            config.temperature = 0.7;
        }
        
        if (typeof config.max_tokens !== 'number' || config.max_tokens < 100 || config.max_tokens > 8192) {
            console.warn('Config: Tokens máximos inválidos, ajustando a 2048');
            config.max_tokens = 2048;
        }
        
        return config;
    } catch (error) {
        console.error('Config: Error al obtener configuración:', error);
        return DEFAULT_CONFIG;
    }
}

/**
 * Actualiza la configuración
 * @param {Object} newConfig - Nueva configuración parcial
 * @returns {Object} La configuración actualizada
 */
function update(newConfig) {
    try {
        const currentConfig = get();
        
        // Validar parámetros antes de actualizar
        const validatedConfig = { ...newConfig };
        
        if (newConfig.temperature !== undefined) {
            validatedConfig.temperature = Math.max(0, Math.min(1, parseFloat(newConfig.temperature) || 0.7));
        }
        
        if (newConfig.max_tokens !== undefined) {
            validatedConfig.max_tokens = Math.max(100, Math.min(8192, parseInt(newConfig.max_tokens) || 2048));
        }
        
        // Combinar y guardar
        const updatedConfig = { ...currentConfig, ...validatedConfig };
        
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(updatedConfig, null, 2), 'utf8');
        console.log('Config: Configuración actualizada correctamente');
        
        return updatedConfig;
    } catch (error) {
        console.error('Config: Error al actualizar configuración:', error);
        throw new Error('No se pudo actualizar la configuración: ' + error.message);
    }
}

/**
 * Restablece la configuración a los valores por defecto
 * @returns {Object} La configuración por defecto
 */
function reset() {
    try {
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2), 'utf8');
        console.log('Config: Configuración restablecida a valores por defecto');
        return DEFAULT_CONFIG;
    } catch (error) {
        console.error('Config: Error al restablecer configuración:', error);
        throw new Error('No se pudo restablecer la configuración: ' + error.message);
    }
}

module.exports = {
    init,
    get,
    update,
    reset,
    DEFAULT_CONFIG
};