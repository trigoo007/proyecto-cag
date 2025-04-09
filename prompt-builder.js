/**
 * Generador de Prompts para CAG
 * 
 * Este módulo construye prompts optimizados para Gemma 3, incorporando
 * contexto enriquecido, instrucciones específicas y formato adecuado.
 */

const fs = require('fs');
const path = require('path');
const config = require('./config');

// Directorio para plantillas de prompts
const TEMPLATES_DIR = path.join(__dirname, 'data', 'templates');

// Máximo de entidades a incluir en el contexto
const MAX_CONTEXT_ENTITIES = 8;
// Máximo de mensajes de historial a incluir
const MAX_HISTORY_MESSAGES = 10;
// Máximo de tokens estimados para el prompt (ajustar según modelo)
const MAX_PROMPT_TOKENS = 4000;

/**
 * Inicializa el generador de prompts
 */
function init() {
    try {
        // Crear directorio de plantillas si no existe
        if (!fs.existsSync(TEMPLATES_DIR)) {
            fs.mkdirSync(TEMPLATES_DIR, { recursive: true });
            console.log('PromptBuilder: Directorio de plantillas creado');
            
            // Crear plantillas por defecto
            createDefaultTemplates();
        }
        
        console.log('PromptBuilder: Inicializado correctamente');
    } catch (error) {
        console.error('PromptBuilder: Error de inicialización:', error);
    }
}

/**
 * Crea plantillas por defecto para prompts
 * @private
 */
function createDefaultTemplates() {
    try {
        // Plantilla de sistema base
        const systemTemplate = {
            name: 'system_base',
            content: `Eres un asistente de inteligencia artificial avanzado basado en Gemma 3 27B.
Respondes de manera útil, clara, precisa, y en tono amable.
Creas respuestas bien estructuradas, con párrafos organizados y formato adecuado.
Eres objetivo, evitas sesgos y no das opiniones políticas.
Para consultas técnicas, proporcionas respuestas precisas y basadas en hechos.
Eres consciente de tus limitaciones como IA y lo indicas cuando sea apropiado.
No finges emociones humanas ni pretendes tener experiencias que no posees.
Respetas la privacidad y evitas preguntar información personal innecesaria.
Si algo está fuera de tu conocimiento o capacidades, lo reconoces con honestidad.
Utilizas markdown cuando es apropiado para mejorar la legibilidad.`
        };
        
        // Plantilla para formato especializado
        const formatTemplate = {
            name: 'format_instructions',
            content: `Para listas, usa formato de markdown con asteriscos (*) dejando espacio después.
Para encabezados, usa # con espacio después (ejemplo: "# Título").
Si necesitas enfatizar texto, usa **texto** para negrita o *texto* para cursiva.
Si incluyes código, utiliza bloques de código con triple backtick y especifica el lenguaje.
Cuando menciones conceptos técnicos o términos importantes, destácalos adecuadamente.
Organiza información compleja en secciones con encabezados claros.
Usa listas numeradas sólo cuando el orden es importante, caso contrario usa viñetas.
Evita párrafos excesivamente largos, dividiendo el contenido en unidades coherentes.`
        };
        
        // Plantilla para procesamiento de entidades
        const entitiesTemplate = {
            name: 'entity_processing',
            content: `Cuando menciones las siguientes entidades, utiliza la información proporcionada:
{{entities}}

Incorpora naturalmente esta información en tus respuestas cuando sea relevante.
No menciones explícitamente que te proporcionaron esta información contextual.`
        };
        
        // Plantilla para contexto de documentos
        const documentsTemplate = {
            name: 'document_context',
            content: `Tienes acceso a la siguiente información de documentos que el usuario ha subido:
{{documents}}

Utiliza esta información cuando responda a preguntas relacionadas.
No menciones explícitamente estos documentos a menos que sea estrictamente necesario.`
        };
        
        // Plantilla de contexto de memoria
        const memoryTemplate = {
            name: 'memory_context',
            content: `Recuerda la siguiente información de interacciones previas:
{{memory_items}}

Usa esta información para dar continuidad a la conversación y evitar repeticiones.`
        };
        
        // Guardar plantillas
        const templates = [
            systemTemplate,
            formatTemplate,
            entitiesTemplate,
            documentsTemplate,
            memoryTemplate
        ];
        
        templates.forEach(template => {
            const templatePath = path.join(TEMPLATES_DIR, `${template.name}.json`);
            fs.writeFileSync(templatePath, JSON.stringify(template, null, 2), 'utf8');
        });
        
        console.log('PromptBuilder: Plantillas por defecto creadas');
    } catch (error) {
        console.error('PromptBuilder: Error al crear plantillas por defecto:', error);
    }
}

/**
 * Construye un prompt mejorado con contexto (CAG)
 * @param {Object} contextMap - Mapa de contexto
 * @param {Object} userConfig - Configuración del usuario
 * @returns {Array} Mensajes para la API de chat
 */
function buildCAGPrompt(contextMap, userConfig = {}) {
    try {
        if (!contextMap) {
            return buildBasicPrompt([], userConfig);
        }
        
        // Cargar configuración del sistema
        const systemConfig = config.get();
        
        // Combinar configuración de usuario con la del sistema
        const mergedConfig = {
            ...systemConfig,
            ...userConfig
        };
        
        // Preparar contexto
        const enhancedContext = prepareEnhancedContext(contextMap);
        
        // Construir mensaje del sistema
        const systemMessage = buildSystemMessage(enhancedContext, mergedConfig);
        
        // Preparar historial de mensajes
        const historyMessages = prepareConversationHistory(contextMap.recentMessages);
        
        // Construir array de mensajes
        const messages = [
            { role: 'system', content: systemMessage },
            ...historyMessages
        ];
        
        return messages;
    } catch (error) {
        console.error('PromptBuilder: Error al construir prompt CAG:', error);
        
        // Construir prompt básico como fallback
        return buildBasicPrompt(contextMap.recentMessages || [], userConfig);
    }
}

/**
 * Construye un prompt básico sin mejoras contextuales
 * @param {Array} messages - Mensajes recientes
 * @param {Object} userConfig - Configuración del usuario
 * @returns {Array} Mensajes para la API de chat
 * @private
 */
function buildBasicPrompt(messages, userConfig = {}) {
    // Cargar configuración del sistema
    const systemConfig = config.get();
    
    // Combinar configuración de usuario con la del sistema
    const mergedConfig = {
        ...systemConfig,
        ...userConfig
    };
    
    // Mensaje de sistema básico
    const systemMessage = mergedConfig.system_prompt || 
        'Eres un asistente amable y útil que responde de forma clara y organizada.';
    
    // Preparar historial (mapear roles a formato esperado)
    const historyMessages = (messages || []).map(msg => ({
        role: msg.role === 'bot' ? 'assistant' : msg.role,
        content: msg.content
    }));
    
    return [
        { role: 'system', content: systemMessage },
        ...historyMessages
    ];
}

/**
 * Prepara un contexto enriquecido para el prompt
 * @param {Object} contextMap - Mapa de contexto original
 * @returns {Object} Contexto enriquecido
 * @private
 */
function prepareEnhancedContext(contextMap) {
    const enhancedContext = {
        entities: [],
        memory: [],
        topics: [],
        documents: [],
        currentMessage: contextMap.currentMessage,
        messageStructure: contextMap.messageStructure,
        sentiment: contextMap.sentiment,
        language: contextMap.language
    };
    
    // Procesar entidades (limitando cantidad)
    if (contextMap.entities && Array.isArray(contextMap.entities)) {
        enhancedContext.entities = contextMap.entities
            .filter(entity => entity.confidence >= 0.6) // Solo entidades con buena confianza
            .slice(0, MAX_CONTEXT_ENTITIES)
            .map(entity => ({
                name: entity.name,
                type: entity.type,
                description: entity.description || null
            }));
    }
    
    // Procesar entidades de memoria global
    if (contextMap.globalMemory && contextMap.globalMemory.entities) {
        const globalEntities = contextMap.globalMemory.entities
            .filter(entity => 
                // Evitar duplicados con las entidades ya incluidas
                !enhancedContext.entities.some(e => 
                    e.name.toLowerCase() === entity.name.toLowerCase()
                )
            )
            .slice(0, MAX_CONTEXT_ENTITIES - enhancedContext.entities.length);
        
        enhancedContext.entities = [...enhancedContext.entities, ...globalEntities];
    }
    
    // Procesar temas
    if (contextMap.topics && Array.isArray(contextMap.topics)) {
        enhancedContext.topics = contextMap.topics
            .filter(topic => topic.confidence >= 0.7)
            .slice(0, 5);
    }
    
    // Añadir temas de memoria global
    if (contextMap.globalMemory && contextMap.globalMemory.topics) {
        const globalTopics = contextMap.globalMemory.topics.slice(0, 3);
        enhancedContext.topics = [...enhancedContext.topics, ...globalTopics]
            .slice(0, 5); // Limitar a 5 temas en total
    }
    
    // Procesar memoria
    if (contextMap.memory) {
        // Extraer ítems relevantes de memoria a corto plazo
        if (contextMap.memory.shortTerm && Array.isArray(contextMap.memory.shortTerm)) {
            const shortTermItems = contextMap.memory.shortTerm
                .filter(item => item.relevance >= 0.7)
                .slice(0, 3);
                
            enhancedContext.memory.push(...shortTermItems);
        }
        
        // Extraer ítems relevantes de memoria a largo plazo
        if (contextMap.memory.longTerm && Array.isArray(contextMap.memory.longTerm)) {
            const longTermItems = contextMap.memory.longTerm
                .filter(item => item.relevance >= 0.8)
                .slice(0, 2);
                
            enhancedContext.memory.push(...longTermItems);
        }
    }
    
    // Procesar documentos
    if (contextMap.documents && Array.isArray(contextMap.documents)) {
        enhancedContext.documents = contextMap.documents.map(doc => ({
            name: doc.originalName,
            summary: doc.summary,
            keyConcepts: doc.keyConcepts ? doc.keyConcepts.slice(0, 5) : [],
            entities: doc.entities ? doc.entities.slice(0, 5) : []
        }));
    }
    
    return enhancedContext;
}

/**
 * Construye el mensaje del sistema con contexto enriquecido
 * @param {Object} context - Contexto enriquecido
 * @param {Object} config - Configuración
 * @returns {string} Mensaje del sistema
 * @private
 */
function buildSystemMessage(context, config) {
    try {
        // Cargar plantilla base del sistema
        const systemTemplate = loadTemplate('system_base');
        let systemMessage = systemTemplate.content;
        
        // Añadir instrucciones de formato si están disponibles
        try {
            const formatTemplate = loadTemplate('format_instructions');
            systemMessage += '\n\n' + formatTemplate.content;
        } catch (error) {
            // Ignorar si no está disponible
        }
        
        // Añadir contexto de entidades si hay disponibles
        if (context.entities && context.entities.length > 0) {
            try {
                const entitiesTemplate = loadTemplate('entity_processing');
                let entitiesContent = entitiesTemplate.content;
                
                // Formatear información de entidades
                const entitiesText = context.entities.map(entity => {
                    let text = `- ${entity.name} (${entity.type})`;
                    if (entity.description) {
                        text += `: ${entity.description}`;
                    }
                    return text;
                }).join('\n');
                
                entitiesContent = entitiesContent.replace('{{entities}}', entitiesText);
                systemMessage += '\n\n' + entitiesContent;
            } catch (error) {
                console.warn('PromptBuilder: Error al procesar plantilla de entidades:', error);
            }
        }
        
        // Añadir contexto de documentos si hay disponibles
        if (context.documents && context.documents.length > 0) {
            try {
                const documentsTemplate = loadTemplate('document_context');
                let documentsContent = documentsTemplate.content;
                
                // Formatear información de documentos
                const documentsText = context.documents.map(doc => {
                    let text = `- ${doc.name}: ${doc.summary}`;
                    
                    if (doc.keyConcepts && doc.keyConcepts.length > 0) {
                        const concepts = doc.keyConcepts
                            .map(c => c.word || c)
                            .slice(0, 5)
                            .join(', ');
                        text += ` [Conceptos clave: ${concepts}]`;
                    }
                    
                    return text;
                }).join('\n');
                
                documentsContent = documentsContent.replace('{{documents}}', documentsText);
                systemMessage += '\n\n' + documentsContent;
            } catch (error) {
                console.warn('PromptBuilder: Error al procesar plantilla de documentos:', error);
            }
        }
        
        // Añadir contexto de memoria si hay disponible
        if (context.memory && context.memory.length > 0) {
            try {
                const memoryTemplate = loadTemplate('memory_context');
                let memoryContent = memoryTemplate.content;
                
                // Formatear ítems de memoria
                const memoryItems = context.memory.map(item => {
                    // Extracto breve del mensaje del usuario
                    const userMessagePreview = item.userMessage ? 
                        (item.userMessage.length > 100 ? 
                            item.userMessage.substring(0, 100) + '...' : 
                            item.userMessage) : 
                        '';
                    
                    // Extracto breve de la respuesta
                    const responsePreview = item.botResponse ? 
                        (item.botResponse.length > 100 ? 
                            item.botResponse.substring(0, 100) + '...' : 
                            item.botResponse) : 
                        '';
                    
                    let text = `- Usuario preguntó sobre: "${userMessagePreview}"`;
                    
                    // Incluir entidades si existen
                    if (item.entities && item.entities.length > 0) {
                        const entityNames = item.entities
                            .map(e => e.name)
                            .slice(0, 3)
                            .join(', ');
                        text += ` [Entidades: ${entityNames}]`;
                    }
                    
                    return text;
                }).join('\n');
                
                memoryContent = memoryContent.replace('{{memory_items}}', memoryItems);
                systemMessage += '\n\n' + memoryContent;
            } catch (error) {
                console.warn('PromptBuilder: Error al procesar plantilla de memoria:', error);
            }
        }
        
        // Añadir información sobre estructura del mensaje actual
        if (context.messageStructure) {
            const structure = context.messageStructure;
            
            // Solo incluir si es una pregunta o comando específico
            if (structure.isQuestion || structure.isCommand) {
                systemMessage += '\n\n';
                
                if (structure.isQuestion) {
                    systemMessage += `El usuario está haciendo una pregunta de tipo "${context.questionType?.type || 'general'}". `;
                    
                    if (structure.complexity === 'complex') {
                        systemMessage += 'La pregunta es compleja, proporciona una respuesta detallada. ';
                    }
                } else if (structure.isCommand) {
                    systemMessage += 'El usuario está solicitando una acción específica. ';
                }
                
                if (context.sentiment && context.sentiment.sentiment === 'urgent') {
                    systemMessage += 'El usuario parece tener urgencia, sé conciso y directo. ';
                } else if (context.sentiment && context.sentiment.sentiment === 'confused') {
                    systemMessage += 'El usuario parece confundido, explica con claridad y sencillez. ';
                }
            }
        }
        
        // Añadir información sobre el idioma
        if (context.language && context.language.code !== 'es') {
            systemMessage += `\n\nResponde en ${context.language.name} (${context.language.code}).`;
        }
        
        // Añadir configuración del sistema (si existe)
        if (config.system_prompt) {
            // Evitar duplicación si es muy similar a la plantilla base
            if (!areTextsVerySimilar(systemTemplate.content, config.system_prompt)) {
                systemMessage += '\n\n' + config.system_prompt;
            }
        }
        
        return systemMessage;
    } catch (error) {
        console.error('PromptBuilder: Error al construir mensaje del sistema:', error);
        
        // Fallback a configuración básica
        return config.system_prompt || 
            'Eres un asistente amable y útil que responde de forma clara y organizada.';
    }
}

/**
 * Prepara el historial de conversación para incluir en el prompt
 * @param {Array} messages - Mensajes recientes
 * @returns {Array} Mensajes formateados para la API
 * @private
 */
function prepareConversationHistory(messages) {
    if (!messages || !Array.isArray(messages)) {
        return [];
    }
    
    // Limitar número de mensajes para evitar exceder tokens
    const limitedMessages = messages.slice(-MAX_HISTORY_MESSAGES);
    
    // Convertir a formato esperado por la API
    return limitedMessages.map(msg => ({
        role: msg.role === 'bot' ? 'assistant' : msg.role,
        content: msg.content
    }));
}

/**
 * Carga una plantilla por su nombre
 * @param {string} templateName - Nombre de la plantilla
 * @returns {Object} Plantilla cargada
 * @private
 */
function loadTemplate(templateName) {
    try {
        const templatePath = path.join(TEMPLATES_DIR, `${templateName}.json`);
        
        if (!fs.existsSync(templatePath)) {
            throw new Error(`Plantilla ${templateName} no encontrada`);
        }
        
        const templateContent = fs.readFileSync(templatePath, 'utf8');
        return JSON.parse(templateContent);
    } catch (error) {
        console.error(`PromptBuilder: Error al cargar plantilla ${templateName}:`, error);
        throw error;
    }
}

/**
 * Compara dos textos para determinar si son muy similares
 * @param {string} text1 - Primer texto
 * @param {string} text2 - Segundo texto
 * @returns {boolean} True si son muy similares
 * @private
 */
function areTextsVerySimilar(text1, text2) {
    if (!text1 || !text2) return false;
    
    // Normalizar textos
    const normalized1 = text1.toLowerCase().replace(/\s+/g, ' ').trim();
    const normalized2 = text2.toLowerCase().replace(/\s+/g, ' ').trim();
    
    // Si uno está contenido completamente en el otro
    if (normalized1.includes(normalized2) || normalized2.includes(normalized1)) {
        return true;
    }
    
    // Calcular similitud simple basada en palabras compartidas
    const words1 = new Set(normalized1.split(/\W+/).filter(w => w.length > 3));
    const words2 = new Set(normalized2.split(/\W+/).filter(w => w.length > 3));
    
    let sharedWords = 0;
    for (const word of words1) {
        if (words2.has(word)) {
            sharedWords++;
        }
    }
    
    const similarityScore = sharedWords / Math.max(words1.size, words2.size);
    return similarityScore > 0.7; // Umbral de similitud
}

/**
 * Guarda una nueva plantilla
 * @param {string} templateName - Nombre de la plantilla
 * @param {string} content - Contenido de la plantilla
 * @returns {boolean} True si se guardó correctamente
 */
function saveTemplate(templateName, content) {
    try {
        if (!templateName || !content) {
            return false;
        }
        
        // Sanitizar nombre de plantilla
        const safeName = templateName.replace(/[^a-z0-9_]/gi, '_').toLowerCase();
        
        const templatePath = path.join(TEMPLATES_DIR, `${safeName}.json`);
        const templateObj = {
            name: safeName,
            content: content
        };
        
        fs.writeFileSync(templatePath, JSON.stringify(templateObj, null, 2), 'utf8');
        
        return true;
    } catch (error) {
        console.error(`PromptBuilder: Error al guardar plantilla ${templateName}:`, error);
        return false;
    }
}

/**
 * Obtiene todas las plantillas disponibles
 * @returns {Array} Lista de plantillas
 */
function getAllTemplates() {
    try {
        if (!fs.existsSync(TEMPLATES_DIR)) {
            return [];
        }
        
        const files = fs.readdirSync(TEMPLATES_DIR)
            .filter(file => file.endsWith('.json'));
        
        return files.map(file => {
            const templatePath = path.join(TEMPLATES_DIR, file);
            try {
                const content = fs.readFileSync(templatePath, 'utf8');
                return JSON.parse(content);
            } catch (err) {
                console.error(`PromptBuilder: Error al leer plantilla ${file}:`, err);
                return { name: file.replace('.json', ''), error: true };
            }
        });
    } catch (error) {
        console.error('PromptBuilder: Error al obtener plantillas:', error);
        return [];
    }
}

// Inicializar el módulo
init();

module.exports = {
    buildCAGPrompt,
    buildBasicPrompt,
    saveTemplate,
    getAllTemplates
};