/**
 * Analizador de Contexto para CAG
 * 
 * Este módulo analiza mensajes para extraer información contextual relevante
 * que mejora la generación de respuestas del modelo.
 */

const fs = require('fs');
const path = require('path');
const entityExtractor = require('./entity-extractor');
const memoryStore = require('./memory-store');
const db = require('./db');

// Directorio para almacenamiento de datos
const DATA_DIR = path.join(__dirname, 'data');
const CONTEXTS_DIR = path.join(DATA_DIR, 'contexts');

// Número máximo de mensajes a considerar para contexto
const MAX_CONTEXT_MESSAGES = 10;
// Umbrales para análisis semántico
const SIMILARITY_THRESHOLD = 0.75;
// Máximo número de temas a extraer
const MAX_TOPICS = 5;

/**
 * Inicializa el analizador de contexto
 */
function init() {
    try {
        // Crear directorio de contextos si no existe
        if (!fs.existsSync(CONTEXTS_DIR)) {
            fs.mkdirSync(CONTEXTS_DIR, { recursive: true });
            console.log('ContextAnalyzer: Directorio de contextos creado');
        }
        
        console.log('ContextAnalyzer: Inicializado correctamente');
    } catch (error) {
        console.error('ContextAnalyzer: Error de inicialización:', error);
    }
}

/**
 * Analiza un mensaje para extraer información contextual
 * @param {string} conversationId - ID de la conversación
 * @param {string} userId - ID del usuario (opcional)
 * @param {string} message - Mensaje a analizar
 * @returns {Promise<Object>} Mapa de contexto generado
 */
async function analyzeMessage(conversationId, userId, message) {
    try {
        // Validar entrada
        if (!message || message.trim() === '') {
            return { currentMessage: '' };
        }
        
        if (!conversationId) {
            console.warn('ContextAnalyzer: No se proporcionó ID de conversación');
            return { currentMessage: message };
        }
        
        // Crear un objeto con el contexto inicial
        const contextMap = {
            currentMessage: message,
            timestamp: new Date().toISOString()
        };
        
        // Obtener historial de conversación
        let conversation = db.getConversation(conversationId);
        if (!conversation) {
            console.warn(`ContextAnalyzer: Conversación ${conversationId} no encontrada`);
            return contextMap;
        }
        
        // Añadir historial reciente (últimos N mensajes)
        contextMap.recentMessages = conversation.messages
            .slice(-MAX_CONTEXT_MESSAGES)
            .map(msg => ({
                role: msg.role,
                content: msg.content,
                timestamp: msg.timestamp
            }));
        
        // Extraer información semántica del mensaje actual
        await extractSemanticInfo(message, contextMap);
        
        // Analizar la relación con mensajes anteriores
        analyzeMessageRelationships(contextMap);
        
        // Cargar memoria si existe
        try {
            const memory = await memoryStore.getMemory(conversationId, userId);
            if (memory) {
                contextMap.memory = memory;
            }
        } catch (memoryError) {
            console.error('ContextAnalyzer: Error al cargar memoria:', memoryError);
        }
        
        // Guardar contexto para uso futuro
        saveContextMap(conversationId, contextMap);
        
        return contextMap;
    } catch (error) {
        console.error('ContextAnalyzer: Error al analizar mensaje:', error);
        // Devolver un contexto mínimo en caso de error
        return { 
            currentMessage: message,
            error: error.message,
            timestamp: new Date().toISOString()
        };
    }
}

/**
 * Extrae información semántica de un mensaje
 * @param {string} message - Mensaje a analizar
 * @param {Object} contextMap - Mapa de contexto a enriquecer
 * @returns {Promise<void>}
 * @private
 */
async function extractSemanticInfo(message, contextMap) {
    try {
        // Extraer entidades
        const entities = await entityExtractor.extractEntities(message);
        if (entities && entities.length > 0) {
            contextMap.entities = entities;
        }
        
        // Detectar intención del mensaje
        const intent = detectIntent(message);
        if (intent) {
            contextMap.intent = intent;
        }
        
        // Extraer temas del mensaje
        const topics = extractTopics(message);
        if (topics && topics.length > 0) {
            contextMap.topics = topics;
        }
        
        // Detectar sentimiento
        const sentiment = analyzeSentiment(message);
        contextMap.sentiment = sentiment;
        
        // Detectar el idioma
        const language = detectLanguage(message);
        contextMap.language = language;
        
        // Analizar estructura del mensaje (pregunta, comando, declaración)
        const structure = analyzeMessageStructure(message);
        contextMap.messageStructure = structure;
        
        // Detectar consultas de información específicas
        if (structure.isQuestion) {
            const questionType = categorizeQuestion(message);
            contextMap.questionType = questionType;
        }
    } catch (error) {
        console.error('ContextAnalyzer: Error al extraer información semántica:', error);
    }
}

/**
 * Analiza las relaciones del mensaje actual con mensajes anteriores
 * @param {Object} contextMap - Mapa de contexto a enriquecer
 * @private
 */
function analyzeMessageRelationships(contextMap) {
    try {
        const { currentMessage, recentMessages } = contextMap;
        if (!recentMessages || recentMessages.length === 0) {
            return;
        }
        
        // Solo analizar los N mensajes más recientes
        const messagesToAnalyze = recentMessages.slice(-MAX_CONTEXT_MESSAGES);
        
        // Detectar referencias a mensajes anteriores
        const references = [];
        let isFollowUp = false;
        
        // Verificar si hay pronombres o referencias implícitas
        const hasPronouns = /\b(él|ella|ellos|ellas|este|esta|esto|estos|estas|eso|esos|esas|lo|los|las|le|les|su|sus|aquel|aquella|aquellos|aquellas)\b/i.test(currentMessage);
        
        // Verificar si hay referencias temporales o secuenciales
        const hasSequential = /\b(antes|después|luego|anteriormente|previamente|primero|segundo|siguiente|entonces|ahora|también|además|y)\b/i.test(currentMessage);
        
        // Verificar si el mensaje es muy corto (posible respuesta a algo anterior)
        const isShortMessage = currentMessage.split(/\s+/).length <= 5;
        
        // Verificar si el mensaje comienza con verbo (posible comando continuando una acción previa)
        const startsWithVerb = /^(muestra|explica|dime|continúa|sigue|busca|analiza|compara|calcula)\b/i.test(currentMessage);
        
        // Combinación de factores para determinar si es un seguimiento
        isFollowUp = hasPronouns || hasSequential || isShortMessage || startsWithVerb;
        
        // Si parece un seguimiento, buscar el mensaje anterior más relevante
        if (isFollowUp) {
            // Encontrar el último mensaje del usuario
            const lastUserMessages = messagesToAnalyze
                .filter(msg => msg.role === 'user')
                .slice(-3); // Considerar los últimos 3 mensajes
            
            if (lastUserMessages.length > 0) {
                references.push({
                    messageIndex: messagesToAnalyze.indexOf(lastUserMessages[lastUserMessages.length - 1]),
                    confidence: 0.8,
                    type: 'followUp'
                });
            }
        }
        
        // Buscar coincidencias específicas con mensajes anteriores
        const words = currentMessage.toLowerCase().split(/\W+/).filter(w => w.length > 3);
        
        messagesToAnalyze.forEach((msg, index) => {
            // Solo verificar mensajes del bot para referencias de contenido
            if (msg.role !== 'bot') return;
            
            const msgWords = msg.content.toLowerCase().split(/\W+/).filter(w => w.length > 3);
            
            // Contar palabras coincidentes
            const matchCount = words.filter(word => msgWords.includes(word)).length;
            
            // Si hay suficientes coincidencias, considerar una referencia
            if (matchCount >= 3 || (matchCount / words.length) > 0.3) {
                references.push({
                    messageIndex: index,
                    confidence: Math.min(0.9, matchCount / words.length + 0.4),
                    type: 'contentReference',
                    matchCount
                });
            }
        });
        
        // Si encontramos referencias, añadirlas al contexto
        if (references.length > 0) {
            contextMap.references = references
                .sort((a, b) => b.confidence - a.confidence)
                .slice(0, 2); // Mantener solo las 2 referencias más confiables
                
            contextMap.isFollowUp = isFollowUp;
        }
    } catch (error) {
        console.error('ContextAnalyzer: Error al analizar relaciones de mensajes:', error);
    }
}

/**
 * Actualiza la memoria y el contexto después de recibir una respuesta
 * @param {string} conversationId - ID de la conversación
 * @param {string} userId - ID del usuario (opcional)
 * @param {Object} contextMap - Mapa de contexto actual
 * @param {string} userMessage - Mensaje del usuario
 * @param {string} botResponse - Respuesta del bot
 * @returns {Promise<Object>} Contexto actualizado
 */
async function updateAfterResponse(conversationId, userId, contextMap, userMessage, botResponse) {
    try {
        if (!contextMap || !conversationId) {
            return {};
        }
        
        // Extraer información de la respuesta del bot
        const responseEntities = await entityExtractor.extractEntities(botResponse);
        
        // Combinar entidades del mensaje y la respuesta
        const allEntities = [...(contextMap.entities || [])];
        
        // Añadir nuevas entidades de la respuesta sin duplicar
        if (responseEntities && responseEntities.length > 0) {
            responseEntities.forEach(entity => {
                if (!allEntities.some(e => e.name.toLowerCase() === entity.name.toLowerCase())) {
                    allEntities.push(entity);
                }
            });
        }
        
        // Actualizar memoria con la interacción completa
        try {
            await memoryStore.updateMemory(conversationId, userId, {
                userMessage,
                botResponse,
                entities: allEntities,
                timestamp: new Date().toISOString(),
                topics: contextMap.topics || [],
                sentiment: contextMap.sentiment
            });
        } catch (memoryError) {
            console.error('ContextAnalyzer: Error al actualizar memoria:', memoryError);
        }
        
        // Actualizar contexto para referencia futura
        contextMap.lastUpdate = new Date().toISOString();
        contextMap.lastBotResponse = {
            content: botResponse,
            entities: responseEntities
        };
        
        saveContextMap(conversationId, contextMap);
        
        return contextMap;
    } catch (error) {
        console.error('ContextAnalyzer: Error en actualización post-respuesta:', error);
        return contextMap || {};
    }
}

/**
 * Extrae temas principales de un texto
 * @param {string} text - Texto a analizar
 * @returns {Array} Lista de temas detectados
 * @private
 */
function extractTopics(text) {
    try {
        // Lista de temas comunes para la detección
        const commonTopics = [
            // Tecnología y ciencia
            { name: 'tecnología', keywords: ['tecnología', 'tech', 'digital', 'dispositivo', 'electrónica', 'gadget'] },
            { name: 'programación', keywords: ['programación', 'código', 'desarrollador', 'software', 'aplicación', 'web', 'app'] },
            { name: 'inteligencia artificial', keywords: ['ia', 'inteligencia artificial', 'machine learning', 'ml', 'neural', 'modelo'] },
            { name: 'ciencia', keywords: ['ciencia', 'científico', 'investigación', 'estudio', 'descubrimiento'] },
            { name: 'matemáticas', keywords: ['matemáticas', 'cálculo', 'algebra', 'estadística', 'número', 'ecuación'] },
            
            // Medicina y salud
            { name: 'salud', keywords: ['salud', 'médico', 'medicina', 'hospital', 'clínica', 'doctor'] },
            { name: 'nutrición', keywords: ['nutrición', 'alimento', 'dieta', 'comida', 'saludable', 'vitamina'] },
            
            // Humanidades
            { name: 'historia', keywords: ['historia', 'histórico', 'pasado', 'antiguo', 'época', 'siglo'] },
            { name: 'literatura', keywords: ['literatura', 'libro', 'novela', 'autor', 'escritor', 'leer'] },
            { name: 'arte', keywords: ['arte', 'pintura', 'museo', 'artista', 'obra', 'creatividad'] },
            { name: 'música', keywords: ['música', 'canción', 'banda', 'concierto', 'instrumento', 'melodía'] },
            
            // Negocios y economía
            { name: 'negocios', keywords: ['negocio', 'empresa', 'emprendimiento', 'startup', 'corporación'] },
            { name: 'economía', keywords: ['economía', 'finanzas', 'mercado', 'inversión', 'bolsa', 'dinero'] },
            
            // Otros
            { name: 'viajes', keywords: ['viaje', 'turismo', 'destino', 'vacaciones', 'hotel', 'país'] },
            { name: 'deportes', keywords: ['deporte', 'fútbol', 'baloncesto', 'tenis', 'competición', 'atleta'] },
            { name: 'educación', keywords: ['educación', 'escuela', 'universidad', 'aprendizaje', 'estudiar', 'enseñar'] },
            { name: 'política', keywords: ['política', 'gobierno', 'elecciones', 'partido', 'estado', 'ley'] },
            { name: 'medio ambiente', keywords: ['ambiente', 'ecología', 'clima', 'sostenible', 'planeta', 'verde'] }
        ];
        
        if (!text || text.trim() === '') {
            return [];
        }
        
        const lowerText = text.toLowerCase();
        const detectedTopics = [];
        
        // Detectar temas basados en palabras clave
        commonTopics.forEach(topic => {
            // Verificar coincidencias con las palabras clave
            const matchCount = topic.keywords.filter(keyword => 
                lowerText.includes(keyword)
            ).length;
            
            if (matchCount > 0) {
                detectedTopics.push({
                    name: topic.name,
                    confidence: Math.min(0.9, 0.5 + (matchCount / topic.keywords.length) * 0.4),
                    matchedKeywords: matchCount
                });
            }
        });
        
        // Ordenar por confianza y limitar a los principales
        return detectedTopics
            .sort((a, b) => b.confidence - a.confidence)
            .slice(0, MAX_TOPICS);
    } catch (error) {
        console.error('ContextAnalyzer: Error al extraer temas:', error);
        return [];
    }
}

/**
 * Detecta la intención del mensaje
 * @param {string} message - Mensaje a analizar
 * @returns {Object} Intención detectada
 * @private
 */
function detectIntent(message) {
    try {
        const lowerMsg = message.toLowerCase();
        
        // Patrones de intención comunes
        const intentPatterns = [
            { 
                name: 'buscar_información', 
                patterns: [
                    /(?:qué|quién|cómo|dónde|cuándo|por qué|cuál|cuánto|cuánta)\s+.+\?/i,
                    /(?:busca|buscar|encontrar|hallar|localizar)\s+.+/i,
                    /(?:información|datos|detalles)\s+(?:sobre|acerca|de)\s+.+/i
                ],
                confidence: 0.85
            },
            { 
                name: 'generar_contenido', 
                patterns: [
                    /(?:crear|generar|escribir|redactar|producir)\s+(?:un|una)\s+.+/i,
                    /(?:escribe|genera|crea|produce|redacta)\s+.+/i,
                    /(?:necesito|quiero|quisiera)\s+(?:un|una)\s+(?:texto|código|historia|ejemplo|guía|resumen)/i
                ],
                confidence: 0.8
            },
            { 
                name: 'solicitar_opinión', 
                patterns: [
                    /(?:qué opinas|qué piensas|cuál es tu opinión|qué te parece)\s+.+\??/i,
                    /(?:crees que|piensas que|consideras que)\s+.+\??/i,
                    /(?:estás de acuerdo|coincides) con\s+.+\??/i
                ],
                confidence: 0.75
            },
            { 
                name: 'acción_comando', 
                patterns: [
                    /^(?:haz|realiza|ejecuta|calcula|analiza|procesa|traduce|convierte|simula)\s+.+/i,
                    /^(?:puedes|podrías)\s+(?:hacer|realizar|ejecutar|calcular|analizar|procesar|traducir|convertir|simular)\s+.+/i
                ],
                confidence: 0.85
            },
            { 
                name: 'saludar', 
                patterns: [
                    /^(?:hola|hey|saludos|buenos días|buenas tardes|buenas noches|qué tal)(?:\s|$|\W)/i
                ],
                confidence: 0.95
            },
            { 
                name: 'agradecer', 
                patterns: [
                    /^(?:gracias|te agradezco|muchas gracias|mil gracias|thank you|thanks)(?:\s|$|\W)/i
                ],
                confidence: 0.95
            },
            { 
                name: 'despedirse', 
                patterns: [
                    /^(?:adiós|hasta luego|hasta pronto|nos vemos|chao|bye|hasta mañana)(?:\s|$|\W)/i
                ],
                confidence: 0.9
            }
        ];
        
        // Verificar cada patrón de intención
        for (const intent of intentPatterns) {
            for (const pattern of intent.patterns) {
                if (pattern.test(lowerMsg)) {
                    return {
                        name: intent.name,
                        confidence: intent.confidence
                    };
                }
            }
        }
        
        // Intención por defecto si no se detecta ninguna específica
        return {
            name: 'conversar',
            confidence: 0.5
        };
    } catch (error) {
        console.error('ContextAnalyzer: Error al detectar intención:', error);
        return {
            name: 'desconocida',
            confidence: 0.3
        };
    }
}

/**
 * Analiza el sentimiento del mensaje
 * @param {string} message - Mensaje a analizar
 * @returns {Object} Sentimiento detectado
 * @private
 */
function analyzeSentiment(message) {
    try {
        // Palabras positivas en español
        const positiveWords = [
            'bien', 'bueno', 'excelente', 'fantástico', 'increíble', 'maravilloso', 
            'genial', 'alegre', 'feliz', 'contento', 'encantado', 'fascinante',
            'agradable', 'positivo', 'optimista', 'satisfecho', 'perfecto', 
            'espectacular', 'brillante', 'asombroso', 'impresionante', 'extraordinario',
            'gracias', 'aprecio', 'amable', 'generoso', 'inspirador', 'enhorabuena',
            'éxito', 'alegría', 'felicidad', 'amor', 'amistad', 'esperanza', 'victoria'
        ];
        
        // Palabras negativas en español
        const negativeWords = [
            'mal', 'malo', 'terrible', 'horrible', 'pésimo', 'deficiente', 'desastre',
            'triste', 'deprimido', 'enojado', 'furioso', 'irritado', 'preocupado', 
            'ansioso', 'estresado', 'decepcionado', 'molesto', 'disgustado', 'aterrador',
            'frustrado', 'doloroso', 'desagradable', 'difícil', 'problemático', 'negativo',
            'error', 'fracaso', 'pérdida', 'derrota', 'miedo', 'odio', 'ira', 'falla',
            'defecto', 'inútil', 'estúpido', 'tonto', 'absurdo', 'ridículo'
        ];
        
        // Palabras de confusión/incertidumbre
        const confusionWords = [
            'confuso', 'confundido', 'perdido', 'desorientado', 'inseguro', 'dudoso',
            'incierto', 'indeciso', 'ambiguo', 'vago', 'no entiendo', 'no comprendo',
            'extraño', 'complicado', 'complejo', 'difícil', 'incomprensible',
            'no está claro', 'duda', 'quizás', 'tal vez', '¿qué quieres decir?'
        ];
        
        // Palabras de urgencia
        const urgencyWords = [
            'urgente', 'inmediato', 'rápido', 'pronto', 'emergencia', 'ahora',
            'sin demora', 'crítico', 'cuanto antes', 'apremiante', 'prioritario',
            'no hay tiempo', 'necesito ya', 'deadline', 'fecha límite'
        ];
        
        const lowerMsg = message.toLowerCase();
        const words = lowerMsg.split(/\W+/).filter(word => word.length > 2);
        
        // Contar apariciones
        let positiveCount = 0;
        let negativeCount = 0;
        let confusionCount = 0;
        let urgencyCount = 0;
        
        words.forEach(word => {
            if (positiveWords.includes(word)) positiveCount++;
            if (negativeWords.includes(word)) negativeCount++;
            if (confusionWords.includes(word)) confusionCount++;
            if (urgencyWords.includes(word)) urgencyCount++;
        });
        
        // Verificar frases específicas para confusión
        confusionWords.forEach(phrase => {
            if (phrase.includes(' ') && lowerMsg.includes(phrase)) {
                confusionCount += 2; // Dar más peso a frases completas
            }
        });
        
        // Verificar la presencia de emojis (simplificado)
        if (/\b(?::\)|:\-\)|;\)|:\D\))\b/.test(message)) positiveCount++;
        if (/\b(?::\(|:\-\(|:\D\()\b/.test(message)) negativeCount++;
        
        // Calcular puntuación de sentimiento (-1 a +1)
        const totalWords = words.length || 1; // Evitar división por cero
        const sentimentScore = (positiveCount - negativeCount) / Math.sqrt(totalWords);
        
        // Determinar sentimiento
        let sentiment = 'neutral';
        if (sentimentScore > 0.1) sentiment = 'positive';
        if (sentimentScore < -0.1) sentiment = 'negative';
        if (confusionCount > totalWords * 0.1) sentiment = 'confused';
        if (urgencyCount > 0) sentiment = 'urgent';
        
        // Calcular intensidad
        const intensity = Math.min(1.0, Math.abs(sentimentScore) * 2);
        
        return {
            sentiment,
            score: sentimentScore,
            intensity,
            stats: {
                positive: positiveCount,
                negative: negativeCount,
                confusion: confusionCount,
                urgency: urgencyCount
            }
        };
    } catch (error) {
        console.error('ContextAnalyzer: Error al analizar sentimiento:', error);
        return {
            sentiment: 'neutral',
            score: 0,
            intensity: 0
        };
    }
}

/**
 * Detecta el idioma del mensaje
 * @param {string} message - Mensaje a analizar
 * @returns {Object} Idioma detectado
 * @private
 */
function detectLanguage(message) {
    try {
        if (!message || message.trim() === '') {
            return { code: 'es', name: 'Spanish', confidence: 0.5 };
        }
        
        // Palabras frecuentes por idioma
        const languageMarkers = {
            es: ['el', 'la', 'los', 'las', 'de', 'en', 'que', 'por', 'con', 'para', 'como', 'pero', 'más', 'este', 'qué', 'cuando', 'hay', 'ser', 'este', 'todo', 'muy'],
            en: ['the', 'and', 'to', 'of', 'a', 'in', 'that', 'is', 'was', 'for', 'on', 'with', 'he', 'it', 'as', 'are', 'at', 'be', 'this', 'from', 'but', 'not', 'they'],
            fr: ['le', 'la', 'les', 'un', 'une', 'des', 'de', 'du', 'en', 'et', 'est', 'que', 'pour', 'dans', 'qui', 'pas', 'sur', 'avec', 'au', 'ce', 'à', 'plus'],
            pt: ['o', 'a', 'os', 'as', 'um', 'uma', 'de', 'do', 'da', 'dos', 'das', 'em', 'no', 'na', 'nos', 'nas', 'e', 'é', 'que', 'para', 'com', 'por', 'mas'],
            it: ['il', 'lo', 'la', 'i', 'gli', 'le', 'un', 'uno', 'una', 'di', 'del', 'della', 'dei', 'delle', 'in', 'nel', 'nella', 'nei', 'nelle', 'e', 'è', 'che', 'per', 'con']
        };
        
        // Nombres completos de idiomas
        const languageNames = {
            es: 'Spanish',
            en: 'English',
            fr: 'French',
            pt: 'Portuguese',
            it: 'Italian'
        };
        
        // Dividir mensaje en palabras
        const words = message.toLowerCase()
            .replace(/[^a-záéíóúüñçàèìòùâêîôûäëïöüãõ\s]/gi, '')
            .split(/\s+/)
            .filter(w => w.length > 1);
        
        // Contar coincidencias para cada idioma
        const scores = {};
        
        Object.keys(languageMarkers).forEach(langCode => {
            const markers = languageMarkers[langCode];
            let matches = 0;
            
            // Contar palabras que coinciden con los marcadores
            words.forEach(word => {
                if (markers.includes(word)) {
                    matches++;
                }
            });
            
            // Calcular puntuación normalizada
            scores[langCode] = words.length > 0 ? matches / words.length : 0;
        });
        
        // Detectar caracteres específicos de idiomas
        if (message.match(/[áéíóúñ¿¡]/)) scores.es += 0.2;
        if (message.match(/[çàèìòùâêîôû]/)) scores.fr += 0.2;
        if (message.match(/[ãõç]/)) scores.pt += 0.2;
        if (message.match(/[àèìòù]/)) scores.it += 0.2;
        
        // Encontrar el idioma con mayor puntuación
        let detectedLang = 'es'; // Español por defecto
        let maxScore = scores.es || 0;
        
        Object.keys(scores).forEach(langCode => {
            if (scores[langCode] > maxScore) {
                maxScore = scores[langCode];
                detectedLang = langCode;
            }
        });
        
        // Por defecto, asumir español si no hay suficiente confianza
        if (maxScore < 0.1) {
            detectedLang = 'es';
            maxScore = 0.5;
        }
        
        return {
            code: detectedLang,
            name: languageNames[detectedLang],
            confidence: Math.min(1, maxScore + 0.3) // Ajustar confianza
        };
    } catch (error) {
        console.error('ContextAnalyzer: Error al detectar idioma:', error);
        return { code: 'es', name: 'Spanish', confidence: 0.5 };
    }
}

/**
 * Analiza la estructura del mensaje
 * @param {string} message - Mensaje a analizar
 * @returns {Object} Estructura detectada
 * @private
 */
function analyzeMessageStructure(message) {
    try {
        if (!message || message.trim() === '') {
            return { type: 'unknown', isQuestion: false };
        }
        
        const trimmed = message.trim();
        
        // Verificar si es una pregunta
        const isQuestion = trimmed.endsWith('?') || 
            /^(?:qué|cuál|cómo|dónde|cuándo|quién|por qué|cuánto)\b/i.test(trimmed);
        
        // Verificar si es un comando
        const isCommand = /^(?:haz|muestra|genera|crea|calcula|explica|lista|enumera|analiza|encuentra|busca|traduce|convierte|compara)\b/i.test(trimmed);
        
        // Verificar si es una solicitud directa
        const isRequest = /^(?:por favor|puedes|podrías|necesito que|quiero que|me gustaría que)\b/i.test(trimmed);
        
        // Verificar si es una conversación casual
        const isCasual = /^(?:hola|buenos días|buenas tardes|buenas noches|hey|saludos|qué tal|adiós|hasta luego|gracias)\b/i.test(trimmed);
        
        // Determinar tipo de estructura
        let type = 'statement'; // Por defecto es una declaración
        
        if (isQuestion) type = 'question';
        else if (isCommand) type = 'command';
        else if (isRequest) type = 'request';
        else if (isCasual) type = 'casual';
        
        // Analizar complejidad
        const wordCount = message.split(/\s+/).length;
        const sentenceCount = message.split(/[.!?]+/).filter(s => s.trim().length > 0).length;
        
        let complexity = 'simple';
        if (wordCount > 30 || sentenceCount > 3) complexity = 'complex';
        else if (wordCount > 15 || sentenceCount > 1) complexity = 'moderate';
        
        return {
            type,
            isQuestion,
            isCommand,
            isRequest,
            isCasual,
            complexity,
            wordCount,
            sentenceCount
        };
    } catch (error) {
        console.error('ContextAnalyzer: Error al analizar estructura del mensaje:', error);
        return { type: 'unknown', isQuestion: false };
    }
}

/**
 * Categoriza el tipo de pregunta
 * @param {string} question - Pregunta a categorizar
 * @returns {Object} Categoría de la pregunta
 * @private
 */
function categorizeQuestion(question) {
    try {
        if (!question || question.trim() === '' || !question.trim().endsWith('?')) {
            return { type: 'other', confidence: 0.3 };
        }
        
        const lowerQuestion = question.toLowerCase();
        
        // Categorías de preguntas
        const categories = [
            {
                type: 'factual',
                patterns: [
                    /^(?:qué|cuál) es\b/i,
                    /^(?:quién|quiénes) (?:fue|fueron|es|son)\b/i,
                    /^(?:cuándo|dónde) (?:fue|es|ocurrió|sucedió)\b/i,
                    /^(?:cuánto|cuántos|cuántas)\b/i
                ],
                confidence: 0.85
            },
            {
                type: 'explanation',
                patterns: [
                    /^(?:por qué|cómo|de qué manera)\b/i,
                    /^(?:explica|explícame|puedes explicar|podrías explicar)/i,
                    /\b(?:funciona|ocurre|sucede|pasa|causa|efecto|razón)\b/i
                ],
                confidence: 0.8
            },
            {
                type: 'procedural',
                patterns: [
                    /^(?:cómo (?:puedo|podría|debo|se puede|hacer|realizar))\b/i,
                    /\b(?:pasos|proceso|procedimiento|método|forma|manera) de\b/i,
                    /\b(?:instrucciones|guía|tutorial|ejemplo de)\b/i
                ],
                confidence: 0.85
            },
            {
                type: 'opinion',
                patterns: [
                    /^(?:qué (?:opinas|piensas|crees))\b/i,
                    /^(?:cuál es tu (?:opinión|punto de vista|perspectiva))\b/i,
                    /\b(?:estás de acuerdo|coincides|mejor|peor|preferible|recomendable)\b/i
                ],
                confidence: 0.75
            },
            {
                type: 'comparison',
                patterns: [
                    /^(?:qué|cuál) es (?:mejor|peor|más|menos)\b/i,
                    /\b(?:diferencia|similitud|semejanza|comparación) entre\b/i,
                    /\b(?:comparar|comparado|versus|vs|frente a)\b/i,
                    /\b(?:ventajas|desventajas|pros|contras)\b/i
                ],
                confidence: 0.85
            },
            {
                type: 'future',
                patterns: [
                    /\b(?:predic|pronóstico|futuro|proyección|tendencia)\b/i,
                    /\b(?:ocurrirá|pasará|sucederá|será|estaremos|nos espera)\b/i,
                    /\b(?:próximos años|siguiente década|porvenir|perspectivas futuras)\b/i
                ],
                confidence: 0.7
            },
            {
                type: 'recommendation',
                patterns: [
                    /\b(?:recomiendas|recomendarías|sugieres|sugerirías|aconsejas)\b/i,
                    /\b(?:debería|convendría|mejor opción|buena idea|vale la pena)\b/i,
                    /\b(?:qué me recomiendas|qué sugieres|qué aconsejas)\b/i
                ],
                confidence: 0.8
            }
        ];
        
        // Verificar cada categoría
        for (const category of categories) {
            for (const pattern of category.patterns) {
                if (pattern.test(lowerQuestion)) {
                    return {
                        type: category.type,
                        confidence: category.confidence
                    };
                }
            }
        }
        
        // Categoría por defecto si no se detecta ninguna específica
        return {
            type: 'other',
            confidence: 0.5
        };
    } catch (error) {
        console.error('ContextAnalyzer: Error al categorizar pregunta:', error);
        return { type: 'other', confidence: 0.3 };
    }
}

/**
 * Guarda el mapa de contexto para una conversación
 * @param {string} conversationId - ID de la conversación
 * @param {Object} contextMap - Mapa de contexto a guardar
 * @private
 */
function saveContextMap(conversationId, contextMap) {
    try {
        if (!conversationId || !contextMap) {
            return;
        }
        
        const contextFile = path.join(CONTEXTS_DIR, `${conversationId}.json`);
        fs.writeFileSync(contextFile, JSON.stringify(contextMap, null, 2), 'utf8');
    } catch (error) {
        console.error(`ContextAnalyzer: Error al guardar contexto para ${conversationId}:`, error);
    }
}

// Inicializar el módulo
init();

module.exports = {
    analyzeMessage,
    updateAfterResponse
};