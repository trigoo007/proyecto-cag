/**
 * Generador de Títulos para Conversaciones - VERSIÓN MEJORADA
 * 
 * Este módulo genera títulos descriptivos para las conversaciones
 * basándose en el contenido de los mensajes y análisis de temas.
 */

class TitleGenerator {
    constructor() {
        // Lista de temas comunes para la detección
        this.commonTopics = [
            // Tecnología y ciencia
            'tecnología', 'programación', 'inteligencia artificial', 'datos', 'web', 
            'desarrollo', 'ciencia', 'matemáticas', 'física', 'química', 'biología',
            'computación', 'software', 'hardware', 'redes', 'internet', 'app', 
            'aplicación', 'móvil', 'computadora', 'robot', 'automatización',
            
            // Medicina y salud
            'medicina', 'salud', 'enfermedad', 'tratamiento', 'diagnóstico',
            'síntomas', 'terapia', 'anatomía', 'fisiología', 'nutrición',
            
            // Humanidades y sociales
            'historia', 'geografía', 'política', 'economía', 'finanzas',
            'arte', 'música', 'literatura', 'cine', 'educación', 'filosofía', 'psicología',
            'sociedad', 'cultura', 'religión', 'idioma', 'lenguaje',
            
            // Otros intereses
            'deporte', 'viajes', 'cocina', 'gastronomía', 'moda', 'decoración',
            'jardinería', 'mascotas', 'animales', 'naturaleza', 'medio ambiente',
            'legal', 'derecho', 'negocios', 'emprendimiento', 'marketing'
        ];
        
        // Palabras comunes en español (para excluir)
        this.commonWords = [
            'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 
            'y', 'o', 'a', 'ante', 'bajo', 'con', 'de', 'desde', 
            'en', 'entre', 'hacia', 'hasta', 'para', 'por', 'según',
            'sin', 'sobre', 'tras', 'que', 'esto', 'esta', 'estos',
            'qué', 'cómo', 'cuándo', 'dónde', 'quién', 'cuál',
            'ser', 'estar', 'tener', 'hacer', 'decir', 'ir', 'ver', 'dar',
            'más', 'menos', 'poco', 'mucho'
        ];
    }
    
    /**
     * Genera un título descriptivo basado en el contenido de la conversación
     * @param {Array} messages - Mensajes de la conversación
     * @returns {string} Título generado
     */
    generateTitle(messages) {
        // Si no hay mensajes, usar título genérico
        if (!messages || messages.length === 0) {
            return 'Nueva conversación';
        }

        // Usar solo mensajes del usuario para generar el título
        const userMessages = messages.filter(msg => msg.role === 'user');
        
        if (userMessages.length === 0) {
            return 'Nueva conversación';
        }

        // Obtener el primer mensaje del usuario (normalmente establece el tema)
        const firstUserMessage = userMessages[0].content;
        
        // Si es una pregunta clara, intentar usarla directamente
        if (this._isQuestion(firstUserMessage)) {
            return this._createTitleFromQuestion(firstUserMessage);
        }
        
        // Si no es una pregunta, intentar extraer un título basado en temas
        const topics = this._extractTopicsFromText(firstUserMessage);
        if (topics.length > 0) {
            return this._createTitleFromTopics(topics);
        }
        
        // Si no se detectan temas, intentar crear un título a partir del mensaje
        return this._createTitleFromMessage(firstUserMessage);
    }

    /**
     * Crea un título a partir del contenido de un mensaje
     * @param {string} message - Contenido del mensaje
     * @returns {string} Título generado
     * @private
     */
    _createTitleFromMessage(message) {
        if (!message || message.trim() === '') {
            return 'Nueva conversación';
        }

        // Limpiar el mensaje
        const cleanMessage = message.trim();
        
        // Si es un mensaje corto, usarlo directamente
        if (cleanMessage.length <= 60) {
            return this._capitalizeFirstLetter(cleanMessage);
        }
        
        // Para mensajes largos, extraer las primeras palabras significativas
        const words = cleanMessage.split(/\s+/);
        let title = '';
        let currentLength = 0;
        let wordCount = 0;
        
        for (const word of words) {
            // Limitar a 8-10 palabras o 60 caracteres
            if (wordCount >= 10 || currentLength + word.length + 1 > 60) {
                break;
            }
            
            // Filtrar palabras irrelevantes o muy cortas
            if (word.length <= 2 || this.commonWords.includes(word.toLowerCase())) {
                // Incluir palabras comunes solo si el título está vacío o para mantener fluidez
                if (title === '' || wordCount < 3) {
                    title += (title ? ' ' : '') + word;
                    currentLength += word.length + (title ? 1 : 0);
                    wordCount++;
                }
                continue;
            }
            
            title += (title ? ' ' : '') + word;
            currentLength += word.length + (title ? 1 : 0);
            wordCount++;
        }
        
        // Añadir puntos suspensivos si el título es claramente truncado
        if (words.length > wordCount && wordCount >= 3) {
            title += '...';
        }
        
        return this._capitalizeFirstLetter(title);
    }
    
    /**
     * Crea un título a partir de una pregunta
     * @param {string} question - Pregunta a convertir en título
     * @returns {string} Título basado en la pregunta
     * @private
     */
    _createTitleFromQuestion(question) {
        // Limpiar y preparar la pregunta
        const cleanQuestion = question.trim();
        
        // Si la pregunta es corta, usarla completa
        if (cleanQuestion.length <= 70) {
            return this._capitalizeFirstLetter(cleanQuestion);
        }
        
        // Truncar preguntas largas manteniendo sentido
        const words = cleanQuestion.split(/\s+/);
        let title = '';
        let currentLength = 0;
        let wordCount = 0;
        
        for (const word of words) {
            // Limitar a 12 palabras o 70 caracteres para preguntas
            if (wordCount >= 12 || currentLength + word.length + 1 > 70) {
                break;
            }
            
            title += (title ? ' ' : '') + word;
            currentLength += word.length + (title ? 1 : 0);
            wordCount++;
        }
        
        // Añadir puntos suspensivos y signo de interrogación si fue truncada
        if (words.length > wordCount) {
            // Verificar si el signo de interrogación se quedó fuera
            if (!title.endsWith('?')) {
                title += '...?';
            } else {
                title += '...';
            }
        }
        
        return this._capitalizeFirstLetter(title);
    }
    
    /**
     * Verifica si un texto es una pregunta
     * @param {string} text - Texto a verificar
     * @returns {boolean} True si es una pregunta
     * @private
     */
    _isQuestion(text) {
        if (!text) return false;
        
        const trimmedText = text.trim();
        
        // Verificar si termina en signo de interrogación
        if (trimmedText.endsWith('?')) {
            return true;
        }
        
        // Verificar si comienza con palabras interrogativas comunes en español
        const interrogatives = ['qué', 'cuál', 'quién', 'cómo', 'dónde', 'cuándo', 'por qué', 'cuánto'];
        const lowerText = trimmedText.toLowerCase();
        
        return interrogatives.some(word => 
            lowerText.startsWith(word + ' ') || lowerText.startsWith('¿' + word)
        );
    }
    
    /**
     * Determina si una conversación necesita actualización de título
     * @param {Object} conversation - Objeto de conversación
     * @returns {boolean} True si necesita actualización
     */
    needsTitleUpdate(conversation) {
        // Si no tiene título o es genérico
        if (!conversation.title || 
            conversation.title === 'Nueva conversación' ||
            conversation.title === 'Untitled' ||
            conversation.title === 'Sin título') {
            return true;
        }
        
        // Si el título fue editado manualmente, no actualizarlo automáticamente
        if (conversation.titleEdited) {
            return false;
        }
        
        // Si tiene pocos mensajes cuando se generó el título pero ahora tiene más
        if (conversation.titleGeneratedAt && 
            conversation.titleGeneratedAt < conversation.messages.length &&
            conversation.messages.length >= 4) {
            
            // Solo actualizar si han pasado al menos 3 mensajes desde la última generación
            if (conversation.messages.length - conversation.titleGeneratedAt >= 3) {
                return true;
            }
        }
        
        return false;
    }

    /**
     * Genera un título mejorado basado en una conversación existente
     * @param {Object} conversation - Objeto de conversación
     * @returns {string} Título mejorado
     */
    improveTitle(conversation) {
        if (!conversation || !conversation.messages || conversation.messages.length < 2) {
            return conversation.title || 'Nueva conversación';
        }
        
        // Si el título fue editado manualmente, respetarlo
        if (conversation.titleEdited) {
            return conversation.title;
        }
        
        // Extraer todos los mensajes de usuario para análisis
        const userMessages = conversation.messages
            .filter(msg => msg.role === 'user')
            .map(msg => msg.content);
        
        if (userMessages.length === 0) {
            return conversation.title || 'Nueva conversación';
        }
        
        // Combinar todos los mensajes para análisis
        const combinedText = userMessages.join(' ');
        
        // Extraer temas de la conversación
        const topics = this._extractTopicsFromText(combinedText);
        
        // Si encontramos temas específicos, usarlos para el título
        if (topics.length > 0) {
            return this._createTitleFromTopics(topics);
        }
        
        // Si no tenemos temas claros, analizar palabras significativas
        const significantWords = this._extractSignificantWords(combinedText);
        
        if (significantWords.length > 0) {
            // Crear un título con las palabras más significativas
            let title = '';
            const wordsToUse = significantWords.slice(0, 4);
            
            if (wordsToUse.length === 1) {
                title = `Conversación sobre ${wordsToUse[0]}`;
            } else {
                title = `${wordsToUse.join(', ')}`;
            }
            
            return this._capitalizeFirstLetter(title);
        }
        
        // Si todo lo demás falla, mantener el título actual o usar el primer mensaje
        return conversation.title || this._createTitleFromMessage(userMessages[0]);
    }

    /**
     * Extrae temas principales de un texto
     * @param {string} text - Texto a analizar
     * @returns {Array} Lista de temas detectados
     * @private
     */
    _extractTopicsFromText(text) {
        if (!text) return [];
        
        const lowerText = text.toLowerCase();
        const detectedTopics = [];
        
        // Detectar temas usando coincidencias exactas y palabras derivadas
        this.commonTopics.forEach(topic => {
            // Comprobar coincidencia exacta
            if (lowerText.includes(topic)) {
                detectedTopics.push(topic);
                return;
            }
            
            // Comprobar palabras derivadas (plurales, adjetivos)
            const derivations = [
                topic + 's',             // plural
                topic + 'es',            // plural alternativo
                topic + 'mente',         // adverbio
                topic + 'ico',           // adjetivo masculino
                topic + 'ica',           // adjetivo femenino
                topic + 'icos',          // adjetivo masculino plural
                topic + 'icas',          // adjetivo femenino plural
                topic.replace(/o$/, 'a') // cambio de género
            ];
            
            for (const derivation of derivations) {
                if (lowerText.includes(derivation)) {
                    detectedTopics.push(topic); // Usar la forma base
                    return;
                }
            }
        });
        
        return [...new Set(detectedTopics)]; // Eliminar duplicados
    }
    
    /**
     * Crea un título a partir de una lista de temas
     * @param {Array} topics - Lista de temas detectados
     * @returns {string} Título generado
     * @private
     */
    _createTitleFromTopics(topics) {
        if (topics.length === 0) {
            return 'Nueva conversación';
        }
        
        if (topics.length === 1) {
            return `Conversación sobre ${topics[0]}`;
        } else if (topics.length === 2) {
            return `${this._capitalizeFirstLetter(topics[0])} y ${topics[1]}`;
        } else {
            // Limitar a máximo 3 temas
            const mainTopics = topics.slice(0, 3);
            
            if (mainTopics.length === 3) {
                return `${this._capitalizeFirstLetter(mainTopics[0])}, ${mainTopics[1]} y ${mainTopics[2]}`;
            } else {
                return `${this._capitalizeFirstLetter(mainTopics[0])}, ${mainTopics[1]} y otros temas`;
            }
        }
    }
    
    /**
     * Extrae palabras significativas de un texto
     * @param {string} text - Texto a analizar
     * @param {number} maxWords - Número máximo de palabras a extraer
     * @returns {Array} Lista de palabras significativas
     * @private
     */
    _extractSignificantWords(text, maxWords = 5) {
        if (!text) return [];
        
        // Filtrar caracteres especiales y dividir por espacios
        const words = text.toLowerCase()
            .replace(/[^\wáéíóúüñ\s]/g, ' ')
            .split(/\s+/)
            .filter(word => 
                word.length > 3 && 
                !this.commonWords.includes(word)
            );
        
        // Contar frecuencia de palabras
        const wordCounts = {};
        words.forEach(word => {
            wordCounts[word] = (wordCounts[word] || 0) + 1;
        });
        
        // Ordenar por frecuencia y tomar las más relevantes
        return Object.entries(wordCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, maxWords)
            .map(([word]) => word);
    }
    
    /**
     * Capitaliza la primera letra de una cadena
     * @param {string} text - Texto a capitalizar
     * @returns {string} Texto con la primera letra en mayúscula
     * @private
     */
    _capitalizeFirstLetter(text) {
        if (!text) return '';
        return text.charAt(0).toUpperCase() + text.slice(1);
    }
}

module.exports = new TitleGenerator();