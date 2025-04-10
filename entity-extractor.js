/**
 * Extractor de Entidades para CAG
 * 
 * Este módulo se encarga de identificar y extraer entidades de los mensajes
 * para enriquecer el contexto y mejorar las respuestas generadas.
 */

const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { NER } = require('some-nlp-library');
const { VectorDB } = require('vector-db-library');
const languageDetect = require('language-detect');

// Configuración
const CONFIG = {
  dataDir: path.join(__dirname, 'data'),
  entitiesDir: path.join(__dirname, 'data', 'entities'),
  maxEntities: 15,
  vectorDimension: 384,
  confidenceThreshold: 0.6,
  languageModels: {
    es: 'spanish',
    en: 'english',
    fr: 'french',
    pt: 'portuguese',
    de: 'german'
  },
  defaultLanguage: 'es'
};

// Inicializar modelos NLP por idioma
const nerModels = {};
let vectorDb = null;

// Almacenamiento de contexto entre extracciones
const conversationContext = {
  recentEntities: [],
  entityFrequency: {},
  lastUpdateTime: null
};

// Métricas para monitoreo de rendimiento
const metrics = {
  totalExtractions: 0,
  successfulExtractions: 0,
  failedExtractions: 0,
  patternMatches: 0,
  nlpMatches: 0,
  databaseMatches: 0,
  extractionTimes: [],
  lastResetTime: new Date().toISOString()
};

// Bases de datos de entidades conocidas
let knownPersons = [];
let knownOrganizations = [];
let knownLocations = [];
let knownConcepts = [];

/**
 * Inicializa el extractor de entidades
 * @returns {Promise<void>}
 */
async function init() {
  try {
    // Crear directorio de entidades si no existe
    if (!fsSync.existsSync(CONFIG.entitiesDir)) {
      await fs.mkdir(CONFIG.entitiesDir, { recursive: true });
      console.log('EntityExtractor: Directorio de entidades creado');
    }
    
    // Cargar datos de entidades conocidas
    await loadEntityDatabases();
    
    // Inicializar base de datos vectorial
    vectorDb = new VectorDB({ 
      dimension: CONFIG.vectorDimension,
      similarity: 'cosine',
      storageDir: path.join(CONFIG.dataDir, 'vector-store')
    });
    await vectorDb.initialize();
    
    // Inicializar modelos NLP
    for (const [lang, modelName] of Object.entries(CONFIG.languageModels)) {
      try {
        nerModels[lang] = new NER(modelName);
        await nerModels[lang].initialize();
        console.log(`EntityExtractor: Modelo NER para ${lang} inicializado`);
      } catch (modelError) {
        console.error(`EntityExtractor: Error inicializando modelo NER para ${lang}:`, modelError);
      }
    }
    
    console.log('EntityExtractor: Inicializado correctamente');
  } catch (error) {
    console.error('EntityExtractor: Error de inicialización:', error);
    throw error;
  }
}

/**
 * Carga las bases de datos de entidades conocidas
 * @private
 * @returns {Promise<void>}
 */
async function loadEntityDatabases() {
  try {
    const databaseFiles = [
      { path: path.join(CONFIG.entitiesDir, 'persons.json'), target: 'persons' },
      { path: path.join(CONFIG.entitiesDir, 'organizations.json'), target: 'organizations' },
      { path: path.join(CONFIG.entitiesDir, 'locations.json'), target: 'locations' },
      { path: path.join(CONFIG.entitiesDir, 'concepts.json'), target: 'concepts' }
    ];
    
    for (const db of databaseFiles) {
      try {
        if (fsSync.existsSync(db.path)) {
          const fileContent = await fs.readFile(db.path, 'utf8');
          const data = JSON.parse(fileContent);
          
          switch (db.target) {
            case 'persons':
              knownPersons = data;
              break;
            case 'organizations':
              knownOrganizations = data;
              break;
            case 'locations':
              knownLocations = data;
              break;
            case 'concepts':
              knownConcepts = data;
              break;
          }
          
          console.log(`EntityExtractor: Cargadas ${data.length} entidades de ${db.target}`);
          
          // Indexar entidades en la base de datos vectorial si tienen embeddings
          for (const entity of data) {
            if (entity.embedding) {
              await addEntityToVectorStore(entity);
            }
          }
        } else {
          // Crear archivo vacío si no existe
          await fs.writeFile(db.path, JSON.stringify([], null, 2), 'utf8');
          console.log(`EntityExtractor: Creado archivo ${db.path}`);
        }
      } catch (parseError) {
        console.error(`EntityExtractor: Error al parsear ${db.path}:`, parseError);
      }
    }
  } catch (error) {
    console.error('EntityExtractor: Error al cargar bases de datos:', error);
    throw error;
  }
}

/**
 * Detecta el idioma de un texto
 * @param {string} text - Texto a analizar
 * @returns {Promise<string>} Código de idioma (es, en, etc.)
 * @private
 */
async function detectLanguage(text) {
  try {
    if (!text || text.length < 10) {
      return CONFIG.defaultLanguage;
    }
    
    const detected = await languageDetect.identify(text);
    
    // Si el idioma está entre los soportados, devolverlo
    if (detected && CONFIG.languageModels[detected.language]) {
      return detected.language;
    }
    
    return CONFIG.defaultLanguage;
  } catch (error) {
    console.error('EntityExtractor: Error detectando idioma:', error);
    return CONFIG.defaultLanguage;
  }
}

/**
 * Genera un embedding para una entidad
 * @param {string} text - Texto para generar embedding
 * @returns {Promise<number[]>} Vector de embedding
 * @private
 */
async function generateEmbedding(text) {
  try {
    // Simulación de generación de embedding - en producción usaría un modelo real
    // como sentence-transformers, OpenAI embeddings API, o similar
    const vector = new Array(CONFIG.vectorDimension).fill(0)
      .map(() => Math.random() * 2 - 1); // Valores entre -1 y 1
    
    // Normalizar el vector (importante para búsqueda por similitud coseno)
    const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
    return vector.map(val => val / magnitude);
  } catch (error) {
    console.error('EntityExtractor: Error generando embedding:', error);
    throw error;
  }
}

/**
 * Añade una entidad a la base de datos vectorial
 * @param {Object} entity - Entidad a añadir
 * @returns {Promise<boolean>} Éxito de la operación
 * @private
 */
async function addEntityToVectorStore(entity) {
  try {
    if (!entity || !entity.name) {
      return false;
    }
    
    // Generar embedding si no existe
    if (!entity.embedding) {
      entity.embedding = await generateEmbedding(entity.name);
    }
    
    // Añadir a la base de datos vectorial
    await vectorDb.insert({
      id: entity.id || uuidv4(),
      vector: entity.embedding,
      payload: {
        name: entity.name,
        type: entity.type,
        description: entity.description,
        aliases: entity.aliases
      }
    });
    
    return true;
  } catch (error) {
    console.error('EntityExtractor: Error añadiendo entidad a vector store:', error);
    return false;
  }
}

/**
 * Busca entidades similares en la base de datos vectorial
 * @param {string} query - Texto de búsqueda
 * @param {Object} options - Opciones de búsqueda
 * @returns {Promise<Array>} Entidades similares encontradas
 * @private
 */
async function searchSimilarEntities(query, options = {}) {
  try {
    const queryEmbedding = await generateEmbedding(query);
    const results = await vectorDb.search({
      vector: queryEmbedding,
      limit: options.limit || 10,
      minScore: options.minScore || 0.7
    });
    
    return results.map(result => ({
      ...result.payload,
      similarity: result.score,
      source: 'vector'
    }));
  } catch (error) {
    console.error('EntityExtractor: Error en búsqueda vectorial:', error);
    return [];
  }
}

/**
 * Extrae entidades de un texto
 * @param {string} text - Texto a analizar
 * @param {Object} options - Opciones de extracción
 * @returns {Promise<Array>} Lista de entidades extraídas
 */
async function extractEntities(text, options = {}) {
  const startTime = Date.now();
  
  try {
    metrics.totalExtractions++;
    
    if (!text || text.trim() === '') {
      return [];
    }
    
    // Detectar idioma del texto
    const language = await detectLanguage(text);
    
    // Combinar múltiples estrategias de extracción
    const [patternEntities, nlpEntities, knownEntities, similarEntities] = await Promise.all([
      extractEntitiesByPattern(text, { language }),
      extractEntitiesWithNLP(text, { language }),
      matchKnownEntities(text),
      searchSimilarEntities(text, { limit: 5, minScore: 0.8 })
    ]);
    
    // Actualizar métricas
    metrics.patternMatches += patternEntities.length;
    metrics.nlpMatches += nlpEntities.length;
    metrics.databaseMatches += knownEntities.length;
    
    // Combinar y deduplicar resultados
    const combinedEntities = mergeDeduplicate([
      ...patternEntities,
      ...nlpEntities,
      ...knownEntities,
      ...similarEntities
    ]);
    
    // Aplicar sistema de puntuación y filtrado
    const scoredEntities = combinedEntities
      .map(entity => ({
        ...entity,
        score: calculateEntityScore(entity, { context: conversationContext })
      }))
      .filter(entity => entity.score > CONFIG.confidenceThreshold);
    
    // Ordenar por puntuación y limitar cantidad
    const finalEntities = scoredEntities
      .sort((a, b) => b.score - a.score)
      .slice(0, CONFIG.maxEntities)
      .map(entity => {
        // Asignar ID único si no existe
        if (!entity.id) {
          entity.id = uuidv4();
        }
        // Eliminar la propiedad score del resultado final
        const { score, ...rest } = entity;
        return rest;
      });
    
    // Actualizar contexto de conversación
    updateConversationContext(finalEntities);
    
    // Actualizar métricas
    metrics.successfulExtractions++;
    metrics.extractionTimes.push(Date.now() - startTime);
    
    return finalEntities;
  } catch (error) {
    console.error('EntityExtractor: Error al extraer entidades:', error);
    metrics.failedExtractions++;
    return [];
  }
}

/**
 * Extrae entidades usando modelos de NLP
 * @param {string} text - Texto a analizar
 * @param {Object} options - Opciones para extracción
 * @returns {Promise<Array>} Entidades detectadas por NLP
 * @private
 */
async function extractEntitiesWithNLP(text, options = {}) {
  try {
    const language = options.language || CONFIG.defaultLanguage;
    
    // Verificar si hay un modelo disponible para este idioma
    if (!nerModels[language]) {
      console.warn(`EntityExtractor: No hay modelo NER disponible para ${language}, usando modelo por defecto`);
      language = CONFIG.defaultLanguage;
    }
    
    // Extraer entidades usando el modelo NER
    const entities = await nerModels[language].extract(text);
    
    return entities.map(entity => ({
      name: entity.text,
      type: mapEntityType(entity.category),
      confidence: entity.score,
      source: 'nlp',
      language
    }));
  } catch (error) {
    console.error('EntityExtractor: Error en extracción con NLP:', error);
    return [];
  }
}

/**
 * Mapea tipos de entidades del NLP a nuestros tipos internos
 * @param {string} nerType - Tipo de entidad del NER
 * @returns {string} Tipo interno
 * @private
 */
function mapEntityType(nerType) {
  const typeMap = {
    'PERSON': 'person',
    'ORGANIZATION': 'organization',
    'LOCATION': 'location',
    'GPE': 'location',
    'FACILITY': 'location',
    'PRODUCT': 'concept',
    'EVENT': 'concept',
    'WORK_OF_ART': 'concept',
    'DATE': 'date',
    'TIME': 'date',
    'MONEY': 'money',
    'PERCENT': 'number',
    'QUANTITY': 'number',
    'ORDINAL': 'number',
    'CARDINAL': 'number',
    'EMAIL': 'email',
    'URL': 'url',
    'LANGUAGE': 'concept'
  };
  
  return typeMap[nerType] || 'other';
}

/**
 * Extrae entidades basadas en patrones mejorados
 * @param {string} text - Texto a analizar
 * @param {Object} options - Opciones para extracción
 * @returns {Promise<Array>} Lista de entidades extraídas
 * @private
 */
async function extractEntitiesByPattern(text, options = {}) {
  try {
    const language = options.language || CONFIG.defaultLanguage;
    
    // Patrones mejorados para detección de entidades
    // Se incluyen las reglas específicas por idioma
    let entityPatterns = [];
    
    if (language === 'es') {
      entityPatterns = [
        // Personas (nombres propios)
        {
          regex: /\b[A-Z][a-zá-úñ]+ (?:[A-Z][a-zá-úñ]+ )?[A-Z][a-zá-úñ]+\b/g,
          type: 'person',
          confidence: 0.7
        },
        // Personas con títulos
        {
          regex: /\b(?:Sr\.|Sra\.|Dr\.|Dra\.|Prof\.|Don|Doña) [A-Z][a-zá-úñ]+(?:\s+[A-Z][a-zá-úñ]+)?\b/g,
          type: 'person',
          confidence: 0.85,
          transform: match => match.replace(/^(?:Sr\.|Sra\.|Dr\.|Dra\.|Prof\.|Don|Doña) /, '')
        },
        // Organizaciones
        {
          regex: /\b(?:Empresa|Compañía|Corporación|Inc\.|Corp\.|S\.A\.|S\.L\.|Ltd\.|LLC|Grupo|Universidad|Colegio|Escuela|Ministerio|Departamento|Gobierno|Fundación|Asociación|Instituto|Centro|Organización)\s+(?:[A-Z][a-zá-úñ]*(?:\s+[A-Za-zá-úñ&]+)*)\b/g,
          type: 'organization',
          confidence: 0.75
        },
        // Organizaciones con acrónimos
        {
          regex: /\b[A-Z]{2,}(?:\s+[A-Za-zá-úñ&]+){1,3}\b/g,
          type: 'organization',
          confidence: 0.65
        },
        // Ubicaciones con preposiciones
        {
          regex: /\b(?:en|desde|hasta|hacia|de)\s+[A-Z][a-zá-úñ]+(?:\s+(?:de|la|las|los|del)\s+[A-Z][a-zá-úñ]+)*\b/g,
          type: 'location',
          confidence: 0.7,
          transform: match => match.replace(/^(?:en|desde|hasta|hacia|de)\s+/, '')
        },
        // Países y ciudades grandes (explícitos)
        {
          regex: /\b(?:España|Madrid|Barcelona|México|Argentina|Colombia|Chile|Perú|Brasil|Estados Unidos|Francia|Alemania|Reino Unido|Italia|China|Japón|Rusia|India|Australia|Canadá)\b/g,
          type: 'location',
          confidence: 0.9
        },
        // Fechas en diversos formatos
        {
          regex: /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b|\b\d{1,2}-\d{1,2}-\d{2,4}\b|\b\d{1,2} de (?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre) de \d{2,4}\b/g,
          type: 'date',
          confidence: 0.95
        },
        // Tecnologías y términos técnicos
        {
          regex: /\b(?:Inteligencia Artificial|Machine Learning|Deep Learning|Procesamiento de Lenguaje Natural|NLP|Blockchain|Internet of Things|IoT|Big Data|Cloud Computing|API|REST|GraphQL|DevOps|CI\/CD|Docker|Kubernetes|AWS|Azure|Google Cloud)\b/g,
          type: 'technology',
          confidence: 0.85
        },
        // Lenguajes de programación y frameworks
        {
          regex: /\b(?:JavaScript|Python|Java|C\+\+|C#|PHP|Ruby|Swift|Kotlin|Go|Rust|React|Angular|Vue|Node\.js|Django|Flask|Laravel|Spring|TensorFlow|PyTorch|pandas|NumPy|SQL|NoSQL|MongoDB|PostgreSQL|MySQL)\b/g,
          type: 'technology',
          confidence: 0.9
        },
        // Cantidades monetarias
        {
          regex: /\b\$\s*\d+(?:[.,]\d+)*(?:\s*(?:USD|EUR|MXN|ARS|CLP|PEN|COP|BRL))?\b|\b\d+(?:[.,]\d+)*\s*(?:dólares|euros|pesos|reales)\b/g,
          type: 'money',
          confidence: 0.9
        },
        // Correos electrónicos
        {
          regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
          type: 'email',
          confidence: 0.95
        },
        // URLs
        {
          regex: /\bhttps?:\/\/(?:www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b(?:[-a-zA-Z0-9()@:%_\+.~#?&//=]*)\b/g,
          type: 'url',
          confidence: 0.95
        }
      ];
    } else if (language === 'en') {
      // Patrones específicos para inglés
      entityPatterns = [
        // Personas (nombres propios)
        {
          regex: /\b[A-Z][a-z]+ (?:[A-Z][a-z]+ )?[A-Z][a-z]+\b/g,
          type: 'person',
          confidence: 0.7
        },
        // Personas con títulos
        {
          regex: /\b(?:Mr\.|Mrs\.|Ms\.|Dr\.|Prof\.) [A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\b/g,
          type: 'person',
          confidence: 0.85,
          transform: match => match.replace(/^(?:Mr\.|Mrs\.|Ms\.|Dr\.|Prof\.) /, '')
        },
        // Organizaciones
        {
          regex: /\b(?:Company|Corporation|Inc\.|Corp\.|Ltd\.|LLC|Group|University|College|School|Ministry|Department|Government|Foundation|Association|Institute|Center|Organisation|Organization)\s+(?:[A-Z][a-z]*(?:\s+[A-Za-z&]+)*)\b/g,
          type: 'organization',
          confidence: 0.75
        },
        // Organizaciones con acrónimos
        {
          regex: /\b[A-Z]{2,}(?:\s+[A-Za-z&]+){1,3}\b/g,
          type: 'organization',
          confidence: 0.65
        },
        // Ubicaciones con preposiciones
        {
          regex: /\b(?:in|from|to|at|of)\s+[A-Z][a-z]+(?:\s+(?:of|the)\s+[A-Z][a-z]+)*\b/g,
          type: 'location',
          confidence: 0.7,
          transform: match => match.replace(/^(?:in|from|to|at|of)\s+/, '')
        },
        // Países y ciudades grandes (explícitos)
        {
          regex: /\b(?:United States|USA|UK|United Kingdom|Canada|Australia|China|Japan|Russia|India|France|Germany|Italy|Spain|Mexico|Brazil|Argentina|Colombia|Chile|Peru)\b/g,
          type: 'location',
          confidence: 0.9
        },
        // Fechas en diversos formatos (inglés)
        {
          regex: /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b|\b\d{1,2}-\d{1,2}-\d{2,4}\b|\b(?:January|February|March|April|May|June|July|August|September|October|November|December) \d{1,2}(?:st|nd|rd|th)?,? \d{2,4}\b/g,
          type: 'date',
          confidence: 0.95
        },
        // El resto de patrones son similares a los de español
        // (Tecnologías, lenguajes, monedas, correos, URLs)
      ];
    } else {
      // Para otros idiomas, usar un conjunto de patrones básicos genéricos
      entityPatterns = [
        // Patrones básicos para detección de entidades en cualquier idioma
        // (Solo ejemplos, en una implementación real se ampliarían)
        {
          regex: /\b[A-Z][a-z]+ (?:[A-Z][a-z]+ )?[A-Z][a-z]+\b/g,
          type: 'person',
          confidence: 0.6
        },
        {
          regex: /\b[A-Z]{2,}(?:\s+[A-Za-z&]+){1,3}\b/g,
          type: 'organization',
          confidence: 0.6
        },
        {
          regex: /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3}\b/g,
          type: 'location',
          confidence: 0.6
        }
      ];
    }
    
    const entities = {};
    
    // Aplicar cada patrón
    entityPatterns.forEach(pattern => {
      const matches = [...new Set(text.match(pattern.regex) || [])];
      
      matches.forEach(match => {
        // Aplicar transformación si existe
        const entityName = pattern.transform ? pattern.transform(match) : match;
        
        if (entityName && entityName.length > 2) {
          const key = `${pattern.type}:${entityName.toLowerCase()}`;
          
          // No duplicar entidades ya detectadas
          if (!entities[key]) {
            entities[key] = {
              name: entityName,
              type: pattern.type,
              confidence: pattern.confidence,
              source: 'pattern',
              language
            };
          }
        }
      });
    });
    
    return Object.values(entities);
  } catch (error) {
    console.error('EntityExtractor: Error en extracción por patrones:', error);
    return [];
  }
}

/**
 * Busca entidades conocidas en el texto
 * @param {string} text - Texto a analizar
 * @returns {Promise<Array>} Lista de entidades encontradas
 * @private
 */
async function matchKnownEntities(text) {
  try {
    const lowerText = ` ${text.toLowerCase()} `; // Añadir espacios para mejorar coincidencias de palabras completas
    const matches = [];
    
    // Revisar entidades conocidas por tipo
    const databases = [
      { entities: knownPersons, type: 'person', confidence: 0.85 },
      { entities: knownOrganizations, type: 'organization', confidence: 0.85 },
      { entities: knownLocations, type: 'location', confidence: 0.85 },
      { entities: knownConcepts, type: 'concept', confidence: 0.8 }
    ];
    
    databases.forEach(db => {
      db.entities.forEach(entity => {
        // Buscar coincidencias exactas
        const entityName = entity.name.toLowerCase();
        if (lowerText.includes(` ${entityName} `) || 
            lowerText.includes(` ${entityName}.`) || 
            lowerText.includes(` ${entityName},`) ||
            lowerText.includes(`(${entityName})`) ||
            lowerText.includes(`"${entityName}"`) ||
            lowerText.includes(`'${entityName}'`)) {
            
          matches.push({
            id: entity.id || uuidv4(),
            name: entity.name,  // Usar el nombre con formato correcto
            type: db.type,
            confidence: db.confidence,
            source: 'database',
            description: entity.description,
            aliases: entity.aliases
          });
          return;
        }
        
        // Buscar coincidencias de alias
        if (entity.aliases && Array.isArray(entity.aliases)) {
          for (const alias of entity.aliases) {
            const aliasLower = alias.toLowerCase();
            if (lowerText.includes(` ${aliasLower} `) || 
                lowerText.includes(` ${aliasLower}.`) || 
                lowerText.includes(` ${aliasLower},`) ||
                lowerText.includes(`(${aliasLower})`) ||
                lowerText.includes(`"${aliasLower}"`) ||
                lowerText.includes(`'${aliasLower}'`)) {
                
              matches.push({
                id: entity.id || uuidv4(),
                name: entity.name,  // Usar el nombre principal
                matchedAlias: alias,
                type: db.type,
                confidence: db.confidence * 0.95, // Ligeramente menor confianza para alias
                source: 'database',
                description: entity.description,
                aliases: entity.aliases
              });
              return;
            }
          }
        }
      });
    });
    
    return matches;
  } catch (error) {
    console.error('EntityExtractor: Error en coincidencia de entidades conocidas:', error);
    return [];
  }
}

/**
 * Combina y deduplica entidades de diferentes fuentes
 * @param {Array} entities - Lista de entidades a combinar
 * @returns {Array} Lista combinada sin duplicados
 * @private
 */
function mergeDeduplicate(entities) {
  const merged = {};
  
  entities.forEach(entity => {
    // Generar clave única para deduplicación
    const key = `${entity.type}:${entity.name.toLowerCase()}`;
    
    if (!merged[key]) {
      // Primera aparición de esta entidad
      merged[key] = { ...entity };
    } else {
      // Entidad ya existente, combinar información
      const existing = merged[key];
      
      // Mantener la mayor confianza
      if (entity.confidence > existing.confidence) {
        existing.confidence = entity.confidence;
      }
      
      // Preferir fuentes más confiables (prioridad: database > nlp > vector > pattern)
      const sourcePriority = {
        'database': 4,
        'nlp': 3,
        'vector': 2,
        'pattern': 1
      };
      
      if ((sourcePriority[entity.source] || 0) > (sourcePriority[existing.source] || 0)) {
        existing.source = entity.source;
      }
      
      // Mantener ID si está disponible
      if (entity.id && !existing.id) {
        existing.id = entity.id;
      }
      
      // Combinar descripciones si están disponibles
      if (entity.description && !existing.description) {
        existing.description = entity.description;
      }
      
      // Combinar alias sin duplicados
      if (entity.aliases) {
        existing.aliases = [...new Set([...(existing.aliases || []), ...entity.aliases])];
      }
      
      // Registrar alias si se encontró uno
      if (entity.matchedAlias && !existing.matchedAlias) {
        existing.matchedAlias = entity.matchedAlias;
      }
    }
  });
  
  return Object.values(merged);
}

/**
 * Calcula una puntuación para una entidad basada en múltiples factores
 * @param {Object} entity - Entidad a puntuar
 * @param {Object} options - Opciones adicionales
 * @returns {number} Puntuación entre 0 y 1
 * @private
 */
function calculateEntityScore(entity, options = {}) {
  // Puntuación base desde la confianza
  let score = entity.confidence || 0.5;
  
  // Factores adicionales
  
  // Longitud del nombre (+)
  // Nombres más largos tienden a ser más específicos
  score += Math.min(0.1, (entity.name.length / 30) * 0.1);
  
  // Fuente de detección (+)
  // Priorizar entidades de fuentes más confiables
  const sourceBoost = {
    'database': 0.2,    // Entidades conocidas tienen prioridad
    'nlp': 0.15,        // Detecciones de NLP son bastante confiables
    'vector': 0.1,      // Entidades similares son algo confiables
    'pattern': 0.05     // Patrones son menos confiables
  };
  score += sourceBoost[entity.source] || 0;
  
  // Frecuencia de aparición en la conversación (+)
  if (options.context && options.context.entityFrequency) {
    const frequency = options.context.entityFrequency[`${entity.type}:${entity.name.toLowerCase()}`] || 0;
    score += Math.min(0.15, frequency * 0.05);
  }
  
  // Si es una entidad reciente en la conversación (+)
  if (options.context && options.context.recentEntities) {
    const isRecent = options.context.recentEntities.some(
      e => e.name.toLowerCase() === entity.name.toLowerCase() && e.type === entity.type
    );
    if (isRecent) {
      score += 0.1;
    }
  }
  
  // Tiene descripción (+)
  if (entity.description) {
    score += 0.05;
  }
  
  // Tiene alias (+)
  if (entity.aliases && entity.aliases.length > 0) {
    score += Math.min(0.05, entity.aliases.length * 0.01);
  }
  
  // Limitar puntuación a rango 0-1
  return Math.min(1, Math.max(0, score));
}

/**
 * Actualiza el contexto de conversación con nuevas entidades
 * @param {Array} entities - Nuevas entidades detectadas
 * @private
 */
function updateConversationContext(entities) {
  try {
    // Actualizar lista de entidades recientes
    // Mantener solo las 20 más recientes
    conversationContext.recentEntities = [
      ...entities,
      ...conversationContext.recentEntities
    ].slice(0, 20);
    
    // Actualizar frecuencias
    entities.forEach(entity => {
      const key = `${entity.type}:${entity.name.toLowerCase()}`;
      conversationContext.entityFrequency[key] = (conversationContext.entityFrequency[key] || 0) + 1;
    });
    
    conversationContext.lastUpdateTime = new Date().toISOString();
  } catch (error) {
    console.error('EntityExtractor: Error actualizando contexto:', error);
  }
}

/**
 * Añade o actualiza una entidad en la base de datos
 * @param {Object} entity - Entidad a guardar
 * @returns {Promise<boolean>} True si se guardó correctamente
 */
async function saveEntity(entity) {
  try {
    if (!entity || !entity.name || !entity.type) {
      return false;
    }
    
    // Asegurar que la entidad tiene un ID único
    if (!entity.id) {
      entity.id = uuidv4();
    }
    
    // Determinar archivo según tipo
    let databaseFile;
    let entityList;
    
    switch (entity.type.toLowerCase()) {
      case 'person':
        databaseFile = path.join(CONFIG.entitiesDir, 'persons.json');
        entityList = knownPersons;
        break;
      case 'organization':
        databaseFile = path.join(CONFIG.entitiesDir, 'organizations.json');
        entityList = knownOrganizations;
        break;
      case 'location':
        databaseFile = path.join(CONFIG.entitiesDir, 'locations.json');
        entityList = knownLocations;
        break;
      case 'concept':
        databaseFile = path.join(CONFIG.entitiesDir, 'concepts.json');
        entityList = knownConcepts;
        break;
      default:
        return false;
    }
    
    // Verificar si la entidad ya existe por ID o nombre
    const existingIndexById = entityList.findIndex(e => e.id === entity.id);
    const existingIndexByName = entityList.findIndex(e => 
      e.name.toLowerCase() === entity.name.toLowerCase()
    );
    
    let existingIndex = existingIndexById >= 0 ? existingIndexById : existingIndexByName;
    
    // Generar embedding si no existe
    if (!entity.embedding) {
      entity.embedding = await generateEmbedding(entity.name);
    }
    
    // Añadir o actualizar
    if (existingIndex >= 0) {
      // Actualizar entidad existente preservando campos importantes
      const existing = entityList[existingIndex];
      
      entityList[existingIndex] = {
        ...existing,
        ...entity,
        id: existing.id || entity.id, // Mantener ID original
        lastUpdated: new Date().toISOString(),
        occurrences: (existing.occurrences || 0) + 1,
        aliases: [...new Set([...(existing.aliases || []), ...(entity.aliases || [])])],
        history: [...(existing.history || []), 
          { timestamp: new Date().toISOString(), change: 'updated' }
        ]
      };
      
      // Asegurar que se actualiza en la base de datos vectorial
      await addEntityToVectorStore(entityList[existingIndex]);
    } else {
      // Añadir nueva entidad
      const newEntity = {
        ...entity,
        created: new Date().toISOString(),
        lastUpdated: new Date().toISOString(),
        occurrences: 1,
        history: [{ timestamp: new Date().toISOString(), change: 'created' }]
      };
      
      entityList.push(newEntity);
      
      // Añadir a la base de datos vectorial
      await addEntityToVectorStore(newEntity);
    }
    
    // Guardar a disco de forma asíncrona
    await fs.writeFile(databaseFile, JSON.stringify(entityList, null, 2), 'utf8');
    
    return true;
  } catch (error) {
    console.error('EntityExtractor: Error al guardar entidad:', error);
    return false;
  }
}

/**
 * Busca entidades por nombre o alias con soporte mejorado
 * @param {string} query - Texto de búsqueda
 * @param {Object} options - Opciones de búsqueda
 * @returns {Promise<Array>} Entidades encontradas
 */
async function searchEntities(query, options = {}) {
  try {
    if (!query || query.trim() === '') {
      return [];
    }
    
    const searchTerm = query.toLowerCase().trim();
    
    // Buscar primero en la base de datos vectorial para resultados semánticos
    const vectorResults = await searchSimilarEntities(query, {
      limit: options.limit || 10,
      minScore: options.minScore || 0.7
    });
    
    // Búsqueda exacta en las bases de datos locales
    const exactResults = await searchExactEntities(query, options);
    
    // Combinar resultados sin duplicados
    const combinedResults = [...exactResults];
    
    // Añadir resultados vectoriales que no estén ya incluidos
    vectorResults.forEach(vecResult => {
      if (!combinedResults.some(r => 
        r.id === vecResult.id || 
        (r.name.toLowerCase() === vecResult.name.toLowerCase() && r.type === vecResult.type)
      )) {
        combinedResults.push({
          ...vecResult,
          matchType: 'semantic',
          similarity: vecResult.similarity
        });
      }
    });
    
    // Ordenar por relevancia
    return combinedResults.sort((a, b) => {
      // Priorizar coincidencias exactas
      if (a.matchType !== b.matchType) {
        const matchTypePriority = { 'name': 3, 'alias': 2, 'semantic': 1, 'description': 0 };
        return matchTypePriority[b.matchType] - matchTypePriority[a.matchType];
      }
      
      // Para coincidencias semánticas, ordenar por similitud
      if (a.matchType === 'semantic' && b.matchType === 'semantic') {
        return b.similarity - a.similarity;
      }
      
      // Para otros casos, ordenar por frecuencia
      return (b.occurrences || 0) - (a.occurrences || 0);
    });
  } catch (error) {
    console.error('EntityExtractor: Error al buscar entidades:', error);
    return [];
  }
}

/**
 * Busca entidades de forma exacta por nombre o alias
 * @param {string} query - Texto de búsqueda
 * @param {Object} options - Opciones de búsqueda
 * @returns {Promise<Array>} Entidades encontradas
 * @private
 */
async function searchExactEntities(query, options = {}) {
  try {
    const searchTerm = query.toLowerCase().trim();
    const results = [];
    
    // Determinar qué bases de datos buscar
    const databasesToSearch = [];
    
    if (!options.type || options.type === 'person') {
      databasesToSearch.push({ list: knownPersons, type: 'person' });
    }
    
    if (!options.type || options.type === 'organization') {
      databasesToSearch.push({ list: knownOrganizations, type: 'organization' });
    }
    
    if (!options.type || options.type === 'location') {
      databasesToSearch.push({ list: knownLocations, type: 'location' });
    }
    
    if (!options.type || options.type === 'concept') {
      databasesToSearch.push({ list: knownConcepts, type: 'concept' });
    }
    
    // Realizar búsqueda
    databasesToSearch.forEach(db => {
      db.list.forEach(entity => {
        let match = false;
        let matchField = null;
        
        // Verificar nombre
        if (entity.name.toLowerCase().includes(searchTerm)) {
          match = true;
          matchField = 'name';
        }
        
        // Verificar alias
        if (!match && entity.aliases && Array.isArray(entity.aliases)) {
          for (const alias of entity.aliases) {
            if (alias.toLowerCase().includes(searchTerm)) {
              match = true;
              matchField = 'alias';
              break;
            }
          }
        }
        
        // Verificar descripción
        if (!match && entity.description && 
            entity.description.toLowerCase().includes(searchTerm)) {
          match = true;
          matchField = 'description';
        }
        
        if (match) {
          results.push({
            ...entity,
            matchType: matchField,
            entityType: db.type
          });
        }
      });
    });
    
    return results;
  } catch (error) {
    console.error('EntityExtractor: Error en búsqueda exacta:', error);
    return [];
  }
}

/**
 * Extrae y analiza las relaciones entre entidades con modelo mejorado
 * @param {Array} entities - Entidades a analizar
 * @param {string} text - Texto original
 * @param {Object} options - Opciones adicionales
 * @returns {Promise<Array>} Relaciones encontradas
 */
async function extractEntityRelations(entities, text, options = {}) {
  try {
    if (!entities || entities.length < 2 || !text) {
      return [];
    }
    
    const language = options.language || await detectLanguage(text);
    
    // Intentar usar modelo de relaciones si está disponible
    let modelRelations = [];
    try {
      // Si existe un modelo NLP para este idioma, usarlo para extracción de relaciones
      if (nerModels[language] && nerModels[language].extractRelations) {
        modelRelations = await nerModels[language].extractRelations(text, entities);
        // Transformar al formato esperado
        modelRelations = modelRelations.map(rel => ({
          sourceEntity: rel.source.name,
          sourceId: rel.source.id,
          targetEntity: rel.target.name,
          targetId: rel.target.id,
          sourceType: rel.source.type,
          targetType: rel.target.type,
          relationType: rel.type,
          confidence: rel.score || 0.8,
          source: 'model'
        }));
      }
    } catch (modelError) {
      console.warn('EntityExtractor: Error en modelo de relaciones, usando patrones:', modelError);
      modelRelations = [];
    }
    
    // Patrones verbales que indican relaciones, específicos para cada idioma
    let relationPatterns = [];
    
    if (language === 'es') {
      relationPatterns = [
        { verb: /(?:es|era|fue|son|eran|fueron) (?:un|una|el|la|los|las) (?:fundador|creador|inventor|autor|director|presidente|CEO|jefe|líder) de/i, 
          relation: 'fundador_de', sourceType: 'person', targetType: 'organization' },
        { verb: /(?:es|era|fue|son|eran|fueron) (?:parte|miembro) de/i, 
          relation: 'miembro_de', sourceType: 'person', targetType: 'organization' },
        { verb: /(?:trabaja|trabajaba|trabajó) (?:en|para)/i, 
          relation: 'trabaja_para', sourceType: 'person', targetType: 'organization' },
        { verb: /(?:está|estaba|estuvo) (?:ubicado|ubicada|localizado|localizada|situado|situada) en/i, 
          relation: 'ubicado_en', sourceType: 'organization', targetType: 'location' },
        { verb: /(?:vive|vivía|vivió|reside|residía|residió) en/i, 
          relation: 'vive_en', sourceType: 'person', targetType: 'location' },
        { verb: /(?:creó|desarrolló|inventó|fundó|estableció)/i, 
          relation: 'creador_de', sourceType: 'person', targetType: 'organization' },
        { verb: /(?:es|era|fue) conocido por/i, 
          relation: 'conocido_por', sourceType: 'person', targetType: 'concept' },
        { verb: /(?:nació|creció) en/i, 
          relation: 'lugar_nacimiento', sourceType: 'person', targetType: 'location' }
      ];
    } else if (language === 'en') {
      relationPatterns = [
        { verb: /(?:is|was|are|were) (?:a|the) (?:founder|creator|inventor|author|director|president|CEO|head|leader) of/i, 
          relation: 'founder_of', sourceType: 'person', targetType: 'organization' },
        { verb: /(?:is|was|are|were) (?:part|member) of/i, 
          relation: 'member_of', sourceType: 'person', targetType: 'organization' },
        { verb: /(?:works|worked) (?:at|for)/i, 
          relation: 'works_for', sourceType: 'person', targetType: 'organization' },
        { verb: /(?:is|was) (?:located|situated) in/i, 
          relation: 'located_in', sourceType: 'organization', targetType: 'location' },
        { verb: /(?:lives|lived|resides|resided) in/i, 
          relation: 'lives_in', sourceType: 'person', targetType: 'location' },
        { verb: /(?:created|developed|invented|founded|established)/i, 
          relation: 'creator_of', sourceType: 'person', targetType: 'organization' },
        { verb: /(?:is|was) known for/i, 
          relation: 'known_for', sourceType: 'person', targetType: 'concept' },
        { verb: /(?:born|grew up) in/i, 
          relation: 'birth_place', sourceType: 'person', targetType: 'location' }
      ];
    } else {
      // Patrones genéricos básicos para otros idiomas
      relationPatterns = [];
    }
    
    const patternRelations = [];
    const lowerText = text.toLowerCase();
    
    // Para cada par de entidades, buscar relaciones
    for (let i = 0; i < entities.length; i++) {
      for (let j = 0; j < entities.length; j++) {
        if (i === j) continue;
        
        const source = entities[i];
        const target = entities[j];
        
        // Para cada patrón que coincida con los tipos de entidad
        relationPatterns.forEach(pattern => {
          if (source.type === pattern.sourceType && target.type === pattern.targetType) {
            // Buscar el patrón verbal entre las dos entidades
            const sourceNameLower = source.name.toLowerCase();
            const targetNameLower = target.name.toLowerCase();
            
            // Verificar si el patrón aparece entre los nombres
            const sourceIndex = lowerText.indexOf(sourceNameLower);
            const targetIndex = lowerText.indexOf(targetNameLower);
            
            if (sourceIndex >= 0 && targetIndex >= 0) {
              // Determinar el orden (quién está primero)
              const firstIndex = Math.min(sourceIndex, targetIndex);
              const secondIndex = Math.max(sourceIndex, targetIndex);
              const middleText = lowerText.substring(firstIndex, secondIndex);
              
              if (pattern.verb.test(middleText)) {
                // Si el patrón está en medio, hay una relación
                patternRelations.push({
                  sourceEntity: source.name,
                  sourceId: source.id,
                  targetEntity: target.name,
                  targetId: target.id,
                  sourceType: source.type,
                  targetType: target.type,
                  relationType: pattern.relation,
                  confidence: 0.75,
                  source: 'pattern'
                });
              }
            }
          }
        });
        
        // Heurística: si dos entidades aparecen muy cerca una de otra, 
        // es probable que estén relacionadas
        const sourcePos = lowerText.indexOf(source.name.toLowerCase());
        const targetPos = lowerText.indexOf(target.name.toLowerCase());
        
        if (sourcePos >= 0 && targetPos >= 0) {
          const distance = Math.abs(sourcePos - targetPos);
          
          // Si están a menos de 50 caracteres, asumir co-ocurrencia
          if (distance < 50) {
            patternRelations.push({
              sourceEntity: source.name,
              sourceId: source.id,
              targetEntity: target.name,
              targetId: target.id,
              sourceType: source.type,
              targetType: target.type,
              relationType: 'co-occurrence',
              confidence: 0.6,
              source: 'proximity'
            });
          }
        }
      }
    }
    
    // Combinar relaciones de modelos y patrones
    const relations = [...modelRelations, ...patternRelations];
    
    // Eliminar duplicados y ordenar por confianza
    const uniqueRelations = [];
    const seenKeys = new Set();
    
    relations.forEach(rel => {
      // Crear clave única para esta relación
      const key = `${rel.sourceId || rel.sourceEntity}:${rel.targetId || rel.targetEntity}:${rel.relationType}`;
      
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        uniqueRelations.push(rel);
      }
    });
    
    return uniqueRelations.sort((a, b) => b.confidence - a.confidence);
  } catch (error) {
    console.error('EntityExtractor: Error al extraer relaciones:', error);
    return [];
  }
}

/**
 * Obtiene estadísticas y métricas de rendimiento
 * @returns {Promise<Object>} Estadísticas del extractor
 */
async function getMetrics() {
  try {
    const avgExtractionTime = metrics.extractionTimes.length > 0
      ? metrics.extractionTimes.reduce((sum, time) => sum + time, 0) / metrics.extractionTimes.length
      : 0;
    
    return {
      totalExtractions: metrics.totalExtractions,
      successRate: metrics.totalExtractions > 0
        ? (metrics.successfulExtractions / metrics.totalExtractions) * 100
        : 0,
      averageExtractionTime: avgExtractionTime,
      sourceDistribution: {
        pattern: metrics.patternMatches,
        nlp: metrics.nlpMatches,
        database: metrics.databaseMatches
      },
      contextStats: {
        recentEntitiesCount: conversationContext.recentEntities.length,
        uniqueEntitiesTracked: Object.keys(conversationContext.entityFrequency).length,
        lastUpdateTime: conversationContext.lastUpdateTime
      },
      databaseStats: {
        persons: knownPersons.length,
        organizations: knownOrganizations.length,
        locations: knownLocations.length,
        concepts: knownConcepts.length
      },
      lastResetTime: metrics.lastResetTime
    };
  } catch (error) {
    console.error('EntityExtractor: Error obteniendo métricas:', error);
    return {};
  }
}

/**
 * Reinicia las métricas de rendimiento
 * @returns {Promise<boolean>} Éxito de la operación
 */
async function resetMetrics() {
  try {
    metrics.totalExtractions = 0;
    metrics.successfulExtractions = 0;
    metrics.failedExtractions = 0;
    metrics.patternMatches = 0;
    metrics.nlpMatches = 0;
    metrics.databaseMatches = 0;
    metrics.extractionTimes = [];
    metrics.lastResetTime = new Date().toISOString();
    
    return true;
  } catch (error) {
    console.error('EntityExtractor: Error al reiniciar métricas:', error);
    return false;
  }
}

/**
 * Proporciona feedback sobre una entidad para mejorar detecciones futuras
 * @param {Object} feedback - Información de feedback
 * @returns {Promise<boolean>} Éxito de la operación
 */
async function provideFeedback(feedback) {
  try {
    if (!feedback || !feedback.entityId || !feedback.isCorrect) {
      return false;
    }
    
    // Aquí se implementaría la lógica para mejorar el sistema basado en feedback
    // Por ejemplo, ajustar pesos de patrones, añadir nuevos patrones, etc.
    
    console.log(`EntityExtractor: Feedback recibido para entidad ${feedback.entityId}:`, 
      feedback.isCorrect ? 'correcto' : 'incorrecto');
    
    // Si se proporciona un valor correcto, actualizar la entidad
    if (!feedback.isCorrect && feedback.correctValue) {
      // Buscar la entidad en todas las bases de datos
      const allDatabases = [
        { list: knownPersons, type: 'person', file: 'persons.json' },
        { list: knownOrganizations, type: 'organization', file: 'organizations.json' },
        { list: knownLocations, type: 'location', file: 'locations.json' },
        { list: knownConcepts, type: 'concept', file: 'concepts.json' }
      ];
      
      for (const db of allDatabases) {
        const entityIndex = db.list.findIndex(e => e.id === feedback.entityId);
        
        if (entityIndex >= 0) {
          // Actualizar la entidad
          const entity = db.list[entityIndex];
          
          // Añadir el valor incorrecto como alias si no existe ya
          if (entity.name !== feedback.correctValue) {
            if (!entity.aliases) {
              entity.aliases = [];
            }
            
            if (!entity.aliases.includes(entity.name)) {
              entity.aliases.push(entity.name);
            }
            
            // Establecer el nuevo nombre correcto
            entity.name = feedback.correctValue;
            
            // Añadir registro histórico
            if (!entity.history) {
              entity.history = [];
            }
            
            entity.history.push({
              timestamp: new Date().toISOString(),
              change: 'name_corrected',
              oldValue: entity.name,
              newValue: feedback.correctValue,
              source: 'feedback'
            });
            
            // Guardar la base de datos actualizada
            await fs.writeFile(
              path.join(CONFIG.entitiesDir, db.file), 
              JSON.stringify(db.list, null, 2), 
              'utf8'
            );
            
            // Actualizar en base de datos vectorial
            await addEntityToVectorStore(entity);
            
            console.log(`EntityExtractor: Entidad ${feedback.entityId} actualizada con feedback`);
            return true;
          }
        }
      }
    }
    
    return true;
  } catch (error) {
    console.error('EntityExtractor: Error procesando feedback:', error);
    return false;
  }
}

// Exportar la API pública
module.exports = {
  init,
  extractEntities,
  saveEntity,
  searchEntities,
  extractEntityRelations,
  getMetrics,
  resetMetrics,
  provideFeedback
};
