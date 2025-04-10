/**
 * Enhanced Conversation Title Generator
 * 
 * A sophisticated module for generating descriptive titles for conversations
 * based on message content analysis, topic detection, and linguistic patterns.
 * 
 * Features:
 * - Multi-language support
 * - Advanced topic extraction using NLP-inspired techniques
 * - Title improvement based on conversation evolution
 * - Memory of previous titles for better context awareness
 * - TF-IDF based significant word extraction
 * 
 * @module TitleGenerator
 * @version 2.0.0
 */

/**
 * TitleGenerator class provides methods to generate, update and manage
 * conversation titles based on content analysis.
 */
class TitleGenerator {
  /**
   * Creates a new TitleGenerator instance with optional configuration
   * 
   * @param {Object} options - Configuration options
   * @param {number} [options.maxTitleLength=70] - Maximum title length
   * @param {number} [options.minUpdateMessages=3] - Minimum messages before title update
   * @param {Array<string>} [options.languages=['es']] - Supported languages
   */
  constructor(options = {}) {
    this.options = {
      maxTitleLength: options.maxTitleLength || 70,
      minUpdateMessages: options.minUpdateMessages || 3,
      languages: options.languages || ['es']
    };
    
    // Initialize language resources
    this.resources = this._initializeResources();
    
    // Topic detection corpus by language
    this.topicCorpus = {
      'es': this._buildSpanishTopicCorpus()
    };
    
    // Store a simplified document frequency database for TF-IDF
    // This simulates word frequency in a general corpus
    this._documentFrequency = this._buildDocumentFrequency();
  }
  
  /**
   * Initializes language resources
   * @returns {Object} Language resources
   * @private
   */
  _initializeResources() {
    return {
      'es': {
        commonWords: [
          'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 
          'y', 'o', 'a', 'ante', 'bajo', 'con', 'de', 'desde', 
          'en', 'entre', 'hacia', 'hasta', 'para', 'por', 'según',
          'sin', 'sobre', 'tras', 'que', 'esto', 'esta', 'estos',
          'qué', 'cómo', 'cuándo', 'dónde', 'quién', 'cuál',
          'ser', 'estar', 'tener', 'hacer', 'decir', 'ir', 'ver', 'dar',
          'más', 'menos', 'poco', 'mucho'
        ],
        interrogatives: [
          'qué', 'cuál', 'quién', 'cómo', 'dónde', 'cuándo', 'por qué', 'cuánto'
        ],
        defaultTitle: 'Nueva conversación',
        genericTitles: ['Nueva conversación', 'Untitled', 'Sin título'],
        topicPrefix: 'Conversación sobre',
        otherTopicsText: 'y otros temas'
      },
      'en': {
        commonWords: [
          'the', 'a', 'an', 'and', 'or', 'but', 'is', 'are', 'was', 'were',
          'be', 'have', 'had', 'do', 'does', 'did', 'will', 'would', 'should',
          'can', 'could', 'may', 'might', 'must', 'to', 'in', 'on', 'at', 'by',
          'for', 'with', 'about', 'against', 'between', 'into', 'through',
          'during', 'before', 'after', 'above', 'below', 'from', 'up', 'down'
        ],
        interrogatives: [
          'what', 'which', 'who', 'how', 'where', 'when', 'why', 'how much', 'how many'
        ],
        defaultTitle: 'New conversation',
        genericTitles: ['New conversation', 'Untitled'],
        topicPrefix: 'Conversation about',
        otherTopicsText: 'and other topics'
      }
    };
  }
  
  /**
   * Builds the Spanish topic corpus with categories
   * @returns {Object} Topic corpus with categories
   * @private
   */
  _buildSpanishTopicCorpus() {
    return {
      technology: [
        'tecnología', 'programación', 'inteligencia artificial', 'datos', 'web', 
        'desarrollo', 'software', 'hardware', 'redes', 'internet', 'app', 
        'aplicación', 'móvil', 'computadora', 'robot', 'automatización',
        'código', 'algoritmo', 'sistema', 'informática', 'computación',
        'ciberseguridad', 'nube', 'servidor', 'dispositivo', 'blockchain'
      ],
      science: [
        'ciencia', 'matemáticas', 'física', 'química', 'biología', 'astronomía',
        'laboratorio', 'experimento', 'teoría', 'científico', 'investigación',
        'elementos', 'molecular', 'átomo', 'célula', 'genética', 'evolución'
      ],
      health: [
        'medicina', 'salud', 'enfermedad', 'tratamiento', 'diagnóstico',
        'síntomas', 'terapia', 'anatomía', 'fisiología', 'nutrición',
        'paciente', 'hospital', 'doctor', 'médico', 'farmacia', 'medicamento',
        'cirugía', 'rehabilitación', 'psicología', 'psiquiatría', 'terapéutico'
      ],
      humanities: [
        'historia', 'geografía', 'política', 'economía', 'finanzas',
        'arte', 'música', 'literatura', 'cine', 'educación', 'filosofía',
        'sociedad', 'cultura', 'religión', 'idioma', 'lenguaje', 'antropología',
        'arqueología', 'sociología', 'lingüística', 'etimología', 'gramática'
      ],
      lifestyle: [
        'deporte', 'viajes', 'cocina', 'gastronomía', 'moda', 'decoración',
        'jardinería', 'mascotas', 'animales', 'naturaleza', 'medio ambiente',
        'turismo', 'recetas', 'hogar', 'bricolaje', 'ejercicio', 'dieta',
        'nutrición', 'estilo de vida', 'bienestar', 'belleza', 'cosmética'
      ],
      business: [
        'legal', 'derecho', 'negocios', 'emprendimiento', 'marketing',
        'empresa', 'corporación', 'startup', 'gestión', 'administración',
        'ventas', 'comercio', 'importación', 'exportación', 'contabilidad',
        'finanzas', 'inversión', 'mercado', 'publicidad', 'recursos humanos'
      ]
    };
  }
  
  /**
   * Builds a simulated document frequency database for TF-IDF calculations
   * This simulates word frequency in a general corpus
   * @returns {Object} Simulated document frequency data
   * @private
   */
  _buildDocumentFrequency() {
    // Simulates word frequency in a corpus of 1000 documents
    // Higher values mean more common words
    return {
      // Very common words (would appear in many documents)
      'información': 850, 'tiempo': 830, 'día': 800, 'persona': 780, 'problema': 750,
      'trabajo': 730, 'cosa': 700, 'parte': 680, 'vida': 650, 'forma': 620,
      'manera': 600, 'ejemplo': 580, 'caso': 560, 'sistema': 550, 'proceso': 540,
      
      // Common words (topic-independent)
      'importante': 500, 'diferente': 480, 'bueno': 470, 'general': 450, 'grande': 440,
      'principal': 420, 'necesario': 400, 'posible': 380, 'pequeño': 360, 'fácil': 340,
      'difícil': 320, 'simple': 300, 'último': 280, 'nuevo': 270, 'viejo': 260,
      
      // Less common words (may be more topic-specific)
      'tecnología': 250, 'programa': 240, 'datos': 230, 'desarrollo': 220, 'internet': 210,
      'ciencia': 200, 'arte': 190, 'política': 180, 'economía': 170, 'historia': 160,
      'medicina': 150, 'educación': 140, 'computadora': 130, 'aplicación': 120, 'red': 110,
      
      // Uncommon/specialized words
      'algoritmo': 90, 'inteligencia': 85, 'artificial': 80, 'robótica': 75, 'blockchain': 70,
      'ciberseguridad': 65, 'neurología': 60, 'cuántico': 55, 'nanotecnología': 50, 'genómica': 45
    };
  }
  
  /**
   * Detects the probable language of a text
   * @param {string} text - Text to analyze
   * @returns {string} Detected language code or default 'es'
   */
  detectLanguage(text) {
    if (!text || typeof text !== 'string') {
      return 'es'; // Default to Spanish
    }
    
    const textLower = text.toLowerCase();
    
    // Simple language detection based on common words frequency
    const languageScores = {
      'es': 0,
      'en': 0
    };
    
    // Spanish markers (common Spanish words and patterns)
    const spanishMarkers = ['el', 'la', 'los', 'las', 'de', 'en', 'que', 'por', 'con', 'para', 'como', 'está', 'qué', 'cómo'];
    
    // English markers (common English words and patterns)
    const englishMarkers = ['the', 'of', 'and', 'to', 'in', 'is', 'it', 'you', 'that', 'was', 'for', 'on', 'are', 'with', 'what', 'how'];
    
    // Count marker occurrences (with word boundaries)
    spanishMarkers.forEach(marker => {
      const regex = new RegExp(`\\b${marker}\\b`, 'gi');
      const matches = textLower.match(regex);
      if (matches) {
        languageScores.es += matches.length;
      }
    });
    
    englishMarkers.forEach(marker => {
      const regex = new RegExp(`\\b${marker}\\b`, 'gi');
      const matches = textLower.match(regex);
      if (matches) {
        languageScores.en += matches.length;
      }
    });
    
    // Special case: check for Spanish-specific characters
    if (/[áéíóúüñ¿¡]/i.test(text)) {
      languageScores.es += 5;
    }
    
    // Return language with highest score
    return languageScores.en > languageScores.es ? 'en' : 'es';
  }
  
  /**
   * Generates a title descriptive based on the conversation messages
   * 
   * @param {Array<Object>} messages - Conversation messages
   * @param {Object} [options] - Generation options
   * @param {string} [options.language] - Force a specific language
   * @returns {string} Generated title
   */
  generateTitle(messages, options = {}) {
    // Handle empty messages
    if (!messages || messages.length === 0) {
      return this.resources.es.defaultTitle;
    }
    
    // Filter user messages for analysis
    const userMessages = messages.filter(msg => msg.role === 'user');
    if (userMessages.length === 0) {
      return this.resources.es.defaultTitle;
    }
    
    // Get the first user message (typically establishes the topic)
    const firstUserMessage = userMessages[0].content;
    
    // Detect language if not specified
    const language = options.language || this.detectLanguage(firstUserMessage);
    const langResource = this.resources[language] || this.resources.es;
    
    // If it's a clear question, try to use it directly
    if (this._isQuestion(firstUserMessage, language)) {
      return this._createTitleFromQuestion(firstUserMessage, language);
    }
    
    // Try to extract topics
    const topics = this._extractTopicsFromText(firstUserMessage, language);
    if (topics.length > 0) {
      return this._createTitleFromTopics(topics, language);
    }
    
    // If no topics detected, create title from message
    return this._createTitleFromMessage(firstUserMessage, language);
  }

  /**
   * Checks if a conversation needs a title update
   * 
   * @param {Object} conversation - Conversation object
   * @returns {boolean} True if the title should be updated
   */
  needsTitleUpdate(conversation) {
    if (!conversation) return false;
    
    // Extract language from conversation context or detect it
    const language = conversation.language || 
                     (conversation.messages && conversation.messages.length > 0 ? 
                       this.detectLanguage(conversation.messages[0].content) : 'es');
    
    const langResource = this.resources[language] || this.resources.es;
    
    // If no title or generic title
    if (!conversation.title || 
        langResource.genericTitles.includes(conversation.title)) {
      return true;
    }
    
    // If the title was manually edited, don't auto-update
    if (conversation.titleEdited) {
      return false;
    }
    
    // If title was generated when there were few messages but now there are more
    if (conversation.titleGeneratedAt && 
        conversation.titleGeneratedAt < conversation.messages.length &&
        conversation.messages.length >= 4) {
      
      // Only update if at least minUpdateMessages new messages since last generation
      if (conversation.messages.length - conversation.titleGeneratedAt >= this.options.minUpdateMessages) {
        return true;
      }
    }
    
    // Check if the conversation has significantly evolved
    if (conversation.titleGeneratedAt && conversation.lastTopics) {
      const userMessages = conversation.messages
        .filter(msg => msg.role === 'user')
        .map(msg => msg.content);
      
      if (userMessages.length > 0) {
        const combinedText = userMessages.join(' ');
        const currentTopics = this._extractTopicsFromText(combinedText, language);
        
        // If the topics have changed significantly, consider updating
        const commonTopics = currentTopics.filter(t => conversation.lastTopics.includes(t));
        if (currentTopics.length > 0 && 
            commonTopics.length < Math.min(currentTopics.length, conversation.lastTopics.length) / 2) {
          return true;
        }
      }
    }
    
    return false;
  }

  /**
   * Improves an existing conversation title based on message content evolution
   * 
   * @param {Object} conversation - Conversation object
   * @param {Object} [context={}] - Additional context information
   * @returns {string} Improved title
   */
  improveTitle(conversation, context = {}) {
    if (!conversation || !conversation.messages || conversation.messages.length < 2) {
      return conversation.title || this.resources.es.defaultTitle;
    }
    
    // Store title history if not present
    if (!conversation.titleHistory) {
      conversation.titleHistory = [];
    }
    
    // If current title is different from last history entry, add to history
    if (conversation.title && 
        (conversation.titleHistory.length === 0 || 
         conversation.titleHistory[conversation.titleHistory.length - 1].title !== conversation.title)) {
      conversation.titleHistory.push({
        title: conversation.title,
        messageCount: conversation.messages.length,
        timestamp: new Date().toISOString()
      });
    }
    
    // If title was manually edited, respect it
    if (conversation.titleEdited) {
      return conversation.title;
    }
    
    // Extract user messages for analysis
    const userMessages = conversation.messages
      .filter(msg => msg.role === 'user')
      .map(msg => msg.content);
    
    if (userMessages.length === 0) {
      return conversation.title || this.resources.es.defaultTitle;
    }
    
    // Detect language from the conversation
    const language = conversation.language || this.detectLanguage(userMessages.join(' '));
    const langResource = this.resources[language] || this.resources.es;
    
    // Get entities from context if available
    const contextEntities = (context.entities || [])
      .filter(e => e.type === 'person' || e.type === 'organization')
      .slice(0, 2)
      .map(e => e.name);
    
    // If significant entities available, use them
    if (contextEntities.length > 0) {
      const entitiesTitle = `${langResource.topicPrefix} ${contextEntities.join(' y ')}`;
      return this._capitalizeFirstLetter(entitiesTitle, language);
    }
    
    // Combine messages for comprehensive analysis
    const combinedText = userMessages.join(' ');
    
    // Extract topics with improved algorithm
    const topics = this._extractTopicsFromText(combinedText, language);
    
    // Save current topics for future comparison
    conversation.lastTopics = topics;
    
    // If we found clear topics, create title from them
    if (topics.length > 0) {
      return this._createTitleFromTopics(topics, language);
    }
    
    // If no clear topics, extract significant words using TF-IDF
    const significantWords = this._extractSignificantWordsTFIDF(combinedText, language);
    
    if (significantWords.length > 0) {
      // Create title with significant words
      let title = '';
      const wordsToUse = significantWords.slice(0, 3);
      
      if (wordsToUse.length === 1) {
        title = `${langResource.topicPrefix} ${wordsToUse[0]}`;
      } else {
        title = `${wordsToUse.join(', ')}`;
      }
      
      return this._capitalizeFirstLetter(title, language);
    }
    
    // If all else fails, keep current title or use the first message
    return conversation.title || this._createTitleFromMessage(userMessages[0], language);
  }

  /**
   * Creates a title from a question text
   * 
   * @param {string} question - Question text
   * @param {string} [language='es'] - Language code
   * @returns {string} Formatted title
   * @private
   */
  _createTitleFromQuestion(question, language = 'es') {
    if (!question) return this.resources[language]?.defaultTitle || 'New conversation';
    
    // Clean and prepare the question
    const cleanQuestion = question.trim();
    const maxLength = this.options.maxTitleLength;
    
    // If the question is short, use it completely
    if (cleanQuestion.length <= maxLength) {
      return this._capitalizeFirstLetter(cleanQuestion, language);
    }
    
    // Truncate long questions while maintaining meaning
    const words = cleanQuestion.split(/\s+/);
    let title = '';
    let currentLength = 0;
    let wordCount = 0;
    
    for (const word of words) {
      // Limit to reasonable number of words or maxLength characters
      if (wordCount >= 12 || currentLength + word.length + 1 > maxLength) {
        break;
      }
      
      title += (title ? ' ' : '') + word;
      currentLength += word.length + (title ? 1 : 0);
      wordCount++;
    }
    
    // Add ellipsis and question mark if truncated
    if (words.length > wordCount) {
      // Check if question mark was cut off
      if (!title.endsWith('?')) {
        title += '...?';
      } else {
        title += '...';
      }
    }
    
    return this._capitalizeFirstLetter(title, language);
  }

  /**
   * Creates a title from arbitrary message text
   * 
   * @param {string} message - Message text
   * @param {string} [language='es'] - Language code
   * @returns {string} Formatted title
   * @private
   */
  _createTitleFromMessage(message, language = 'es') {
    const langResource = this.resources[language] || this.resources.es;
    
    if (!message || message.trim() === '') {
      return langResource.defaultTitle;
    }

    // Clean the message
    const cleanMessage = message.trim();
    
    // If it's a short message, use it directly
    if (cleanMessage.length <= 60) {
      return this._capitalizeFirstLetter(cleanMessage, language);
    }
    
    // For long messages, extract the most meaningful words
    const words = cleanMessage.split(/\s+/);
    let title = '';
    let currentLength = 0;
    let wordCount = 0;
    
    for (const word of words) {
      // Limit to reasonable words or characters
      if (wordCount >= 10 || currentLength + word.length + 1 > 60) {
        break;
      }
      
      // Filter irrelevant or very short words
      if (word.length <= 2 || langResource.commonWords.includes(word.toLowerCase())) {
        // Include common words only if title is empty or for fluency
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
    
    // Add ellipsis if clearly truncated
    if (words.length > wordCount && wordCount >= 3) {
      title += '...';
    }
    
    return this._capitalizeFirstLetter(title, language);
  }

  /**
   * Creates a title from a list of detected topics
   * 
   * @param {Array<string>} topics - List of detected topics
   * @param {string} [language='es'] - Language code
   * @returns {string} Formatted title based on topics
   * @private
   */
  _createTitleFromTopics(topics, language = 'es') {
    const langResource = this.resources[language] || this.resources.es;
    
    if (topics.length === 0) {
      return langResource.defaultTitle;
    }
    
    if (topics.length === 1) {
      return `${langResource.topicPrefix} ${topics[0]}`;
    } else if (topics.length === 2) {
      return `${this._capitalizeFirstLetter(topics[0], language)} y ${topics[1]}`;
    } else {
      // Limit to maximum 3 topics
      const mainTopics = topics.slice(0, 3);
      
      if (mainTopics.length === 3) {
        return `${this._capitalizeFirstLetter(mainTopics[0], language)}, ${mainTopics[1]} y ${mainTopics[2]}`;
      } else {
        return `${this._capitalizeFirstLetter(mainTopics[0], language)}, ${mainTopics[1]} ${langResource.otherTopicsText}`;
      }
    }
  }

  /**
   * Determines if text is a question
   * 
   * @param {string} text - Text to analyze
   * @param {string} [language='es'] - Language code
   * @returns {boolean} True if the text is a question
   * @private
   */
  _isQuestion(text, language = 'es') {
    if (!text) return false;
    
    const langResource = this.resources[language] || this.resources.es;
    const trimmedText = text.trim();
    
    // Check if it ends with a question mark
    if (trimmedText.endsWith('?')) {
      return true;
    }
    
    // Check if it starts with interrogative words
    const lowerText = trimmedText.toLowerCase();
    
    return langResource.interrogatives.some(word => 
      lowerText.startsWith(word + ' ') || 
      (language === 'es' && lowerText.startsWith('¿' + word)) ||
      (language === 'en' && lowerText.startsWith(word))
    );
  }

  /**
   * Extracts topics from text using an improved algorithm
   * 
   * @param {string} text - Text to analyze
   * @param {string} [language='es'] - Language code
   * @returns {Array<string>} List of detected topics
   * @private
   */
  _extractTopicsFromText(text, language = 'es') {
    if (!text) return [];
    
    const lowerText = text.toLowerCase();
    const detectedTopics = new Set();
    
    // Get topic corpus for the language
    const topicCorpus = language === 'es' ? this.topicCorpus.es : null;
    if (!topicCorpus) return [];
    
    // Iterate through all topic categories
    Object.values(topicCorpus).forEach(categoryTopics => {
      categoryTopics.forEach(topic => {
        // Check exact match
        if (lowerText.includes(topic)) {
          detectedTopics.add(topic);
          return;
        }
        
        // Skip very short topics for derived forms to reduce false positives
        if (topic.length <= 3) return;
        
        // Check word boundaries for more precise matching
        const wordBoundaryRegex = new RegExp(`\\b${topic}\\b`, 'i');
        if (wordBoundaryRegex.test(lowerText)) {
          detectedTopics.add(topic);
          return;
        }
        
        // Check derived forms (plurals, adjectives)
        const derivations = this._generateDerivedForms(topic, language);
        
        for (const derivation of derivations) {
          if (lowerText.includes(derivation)) {
            detectedTopics.add(topic); // Use the base form
            return;
          }
        }
      });
    });
    
    return Array.from(detectedTopics);
  }

  /**
   * Generates derived forms of a word based on language rules
   * 
   * @param {string} word - Base word
   * @param {string} language - Language code
   * @returns {Array<string>} List of derived forms
   * @private
   */
  _generateDerivedForms(word, language = 'es') {
    const derivations = [];
    
    if (language === 'es') {
      // Spanish derivations
      derivations.push(
        word + 's',             // plural
        word + 'es',            // alternative plural
        word + 'mente',         // adverb
        word + 'ico',           // masculine adjective
        word + 'ica',           // feminine adjective
        word + 'icos',          // masculine plural adjective
        word + 'icas',          // feminine plural adjective
        word + 'ado',           // past participle
        word + 'ada',           // feminine past participle
        word + 'ados',          // masculine plural past participle
        word + 'adas',          // feminine plural past participle
        word.replace(/o$/, 'a') // gender change
      );
      
      // Handle special cases for better matching
      if (word.endsWith('ción')) {
        derivations.push(word.replace(/ción$/, 'ciones')); // pluralization
      }
      if (word.endsWith('dad')) {
        derivations.push(word.replace(/dad$/, 'dades')); // pluralization
      }
      if (word.endsWith('z')) {
        derivations.push(word.replace(/z$/, 'ces')); // pluralization
      }
    } else if (language === 'en') {
      // English derivations
      derivations.push(
        word + 's',              // plural
        word + 'es',             // alternative plural
        word + 'ed',             // past tense
        word + 'ing',            // gerund
        word + 'ly',             // adverb
        word + 'er',             // comparative
        word + 'est',            // superlative
        word.replace(/y$/, 'ies') // plural for words ending in y
      );
      
      // Double last consonant for -ing and -ed forms
      if (/[bcdfghjklmnpqrstvwxz][aeiou][bcdfghjklmnpqrstvwxz]$/.test(word)) {
        const lastChar = word.charAt(word.length - 1);
        derivations.push(word + lastChar + 'ed', word + lastChar + 'ing');
      }
    }
    
    return derivations;
  }

  /**
   * Extracts significant words using TF-IDF algorithm
   * 
   * @param {string} text - Text to analyze
   * @param {string} [language='es'] - Language code
   * @param {number} [maxWords=5] - Maximum words to return
   * @returns {Array<string>} List of significant words sorted by relevance
   * @private
   */
  _extractSignificantWordsTFIDF(text, language = 'es', maxWords = 5) {
    if (!text) return [];
    
    const langResource = this.resources[language] || this.resources.es;
    
    // Clean and tokenize text
    const tokens = text.toLowerCase()
      .replace(/[^\wáéíóúüñ\s]/g, ' ')
      .split(/\s+/)
      .filter(word => 
        word.length > 3 && 
        !langResource.commonWords.includes(word)
      );
    
    if (tokens.length === 0) return [];
    
    // Calculate term frequency
    const termFrequency = {};
    tokens.forEach(token => {
      termFrequency[token] = (termFrequency[token] || 0) + 1;
    });
    
    // Calculate TF-IDF scores
    const totalDocuments = 1000; // Simulated corpus size
    const scores = {};
    
    Object.entries(termFrequency).forEach(([term, frequency]) => {
      // Term frequency normalized by document length
      const tf = frequency / tokens.length;
      
      // Inverse document frequency from our simulated corpus
      // If not in our corpus, use a calculated value based on word length
      const documentFrequency = this._documentFrequency[term] || this._estimateDocumentFrequency(term);
      const idf = Math.log(totalDocuments / (documentFrequency + 1));
      
      // TF-IDF score
      scores[term] = tf * idf;
    });
    
    // Sort by score and return top words
    return Object.entries(scores)
      .sort((a, b) => b[1] - a[1])
      .slice(0, maxWords)
      .map(([term]) => term);
  }

  /**
   * Estimates document frequency for words not in our dataset
   * 
   * @param {string} word - Word to estimate
   * @returns {number} Estimated document frequency
   * @private
   */
  _estimateDocumentFrequency(word) {
    // Heuristic: longer words tend to be more specialized/rare
    const lengthFactor = Math.max(1, 10 - word.length / 2);
    
    // Word shapes that indicate common vs. specialized terms
    let specialization = 100;
    
    // Technical suffixes suggest specialized terms
    if (word.match(/(ción|miento|ología|ística|logía|nomía)$/)) {
      specialization = 60;
    }
    // Very common word patterns
    else if (word.match(/^(sobre|sub|re|pre|con|des)/)) {
      specialization = 200;
    }
    
    return Math.min(500, Math.max(10, specialization * lengthFactor));
  }

  /**
   * Capitalizes the first letter of a string
   * 
   * @param {string} text - Text to capitalize
   * @param {string} [language='es'] - Language code (for future language-specific rules)
   * @returns {string} Text with first letter capitalized
   * @private
   */
  _capitalizeFirstLetter(text, language = 'es') {
    if (!text) return '';
    return text.charAt(0).toUpperCase() + text.slice(1);
  }
}

/**
 * Factory function to create a new TitleGenerator with custom options
 * 
 * @param {Object} options - Configuration options
 * @returns {TitleGenerator} Configured TitleGenerator instance
 */
function createTitleGenerator(options = {}) {
  return new TitleGenerator(options);
}

// Export both the factory and a default instance
module.exports = {
  createTitleGenerator,
  defaultGenerator: new TitleGenerator()
};
