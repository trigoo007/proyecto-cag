/**
 * Cliente para CAG Chat
 * 
 * Este archivo maneja toda la lógica del cliente para la aplicación CAG,
 * incluyendo la gestión de conversaciones, documentos, interfaz de usuario
 * y comunicación con el servidor.
 * 
 * @version 2.0.0
 * @author CAG Team
 */

// ===== CONSTANTES =====
/**
 * Configuración predeterminada para la aplicación
 * @constant
 */
const DEFAULT_SETTINGS = {
    temperature: 0.7,
    max_tokens: 2048,
    system_prompt: null,
    darkMode: false,
    autoScroll: true,
    memoryEnabled: true,
    globalMemoryEnabled: true,
    model: 'gemma3:27b'
};

/**
 * Constantes para tipos de notificaciones
 * @constant
 */
const TOAST_TYPES = {
    SUCCESS: 'success',
    ERROR: 'error',
    WARNING: 'warning',
    INFO: 'info'
};

/**
 * Constantes para mensajes de error
 * @constant
 */
const ERROR_MESSAGES = {
    LOAD_CONVERSATIONS: 'No se pudieron cargar las conversaciones',
    LOAD_CONVERSATION: 'No se pudo cargar la conversación',
    CREATE_CONVERSATION: 'No se pudo crear la conversación',
    DELETE_CONVERSATION: 'No se pudo eliminar la conversación',
    SEND_MESSAGE: 'No se pudo enviar o generar respuesta',
    LOAD_DOCUMENTS: 'No se pudieron cargar los documentos',
    UPLOAD_DOCUMENT: 'No se pudo procesar el documento',
    DELETE_DOCUMENT: 'No se pudo eliminar el documento',
    RESET_MEMORY: 'No se pudo reiniciar la memoria',
    CONNECTION: 'Error de conexión al servidor',
    SEARCH: 'No se pudo realizar la búsqueda',
    INVALID_FILE_TYPE: 'Tipo de archivo no válido'
};

/**
 * Constantes para mensajes de éxito
 * @constant
 */
const SUCCESS_MESSAGES = {
    CONVERSATION_CREATED: 'Nueva conversación iniciada',
    CONVERSATION_DELETED: 'La conversación ha sido eliminada',
    DOCUMENT_UPLOADED: 'ha sido procesado correctamente',
    DOCUMENT_DELETED: 'El documento ha sido eliminado',
    MEMORY_RESET: 'La memoria ha sido reiniciada correctamente',
    SETTINGS_SAVED: 'Los cambios han sido aplicados',
    SETTINGS_RESET: 'Se han restaurado los valores predeterminados',
    TEXT_COPIED: 'Texto copiado al portapapeles'
};

/**
 * Tipos de archivo permitidos para subir
 * @constant
 */
const ALLOWED_FILE_TYPES = [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword',
    'text/plain',
    'text/markdown',
    'text/csv',
    'application/json',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
];

/**
 * Tiempo máximo de espera para peticiones fetch (en ms)
 * @constant
 */
const FETCH_TIMEOUT = 30000;

/**
 * Número máximo de intentos para peticiones fetch
 * @constant
 */
const MAX_RETRY_ATTEMPTS = 3;

/**
 * Tiempo de espera entre reintentos (en ms)
 * @constant
 */
const RETRY_DELAY = 1000;

/**
 * Límite de mensajes para virtualización
 * @constant
 */
const MESSAGE_VIRTUALIZATION_THRESHOLD = 50;

/**
 * Tiempo de debounce para inputs (en ms)
 * @constant
 */
const DEBOUNCE_TIMEOUT = 300;

// ===== VARIABLES GLOBALES =====
let currentConversationId = null;
let currentSettings = { ...DEFAULT_SETTINGS };
let isPendingResponse = false;
let documentUploadPending = false;
let reconnectAttempts = 0;
let isReconnecting = false;
let messageObserver = null;
let lastNetworkStatus = true;
let csrfToken = '';

// Caché para virtualización
let allMessages = [];
let virtualizedMessageIds = new Set();

// ===== INICIALIZACIÓN =====
/**
 * Inicializa la aplicación cuando el DOM está cargado
 * @async
 */
document.addEventListener('DOMContentLoaded', async () => {
    // Obtener CSRF token
    fetchCSRFToken();
    
    // Cargar configuración
    loadSettings();
    
    // Inicializar eventos para elementos UI
    initUIEvents();
    
    // Inicializar markdown y highlight.js
    initRenderers();
    
    // Comprobar estado del sistema
    checkSystemStatus();
    
    // Inicializar detección de conexión
    initConnectionDetection();
    
    // Cargar lista de conversaciones
    await loadConversations();
    
    // Inicializar pestañas
    initTabs();
    
    // Inicializar detección de tema oscuro
    detectDarkMode();
    
    // Inicializar virtualización si es necesario
    initVirtualization();
    
    // Inicializar manejo de accesibilidad
    initAccessibility();
});

// ===== INICIALIZACIÓN DE UI =====
/**
 * Inicializa los eventos de la interfaz de usuario
 */
function initUIEvents() {
    // Botón de nueva conversación
    const newChatBtn = document.getElementById('new-chat-btn');
    newChatBtn.addEventListener('click', createNewConversation);
    newChatBtn.setAttribute('aria-label', 'Crear nueva conversación');
    
    // Input de mensaje
    const messageInput = document.getElementById('message-input');
    messageInput.addEventListener('input', debounce(handleMessageInput, DEBOUNCE_TIMEOUT));
    messageInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });
    messageInput.setAttribute('aria-label', 'Escribe un mensaje');
    
    // Botón de enviar
    const sendBtn = document.getElementById('send-btn');
    sendBtn.addEventListener('click', sendMessage);
    sendBtn.setAttribute('aria-label', 'Enviar mensaje');
    
    // Botón de configuración
    const settingsBtn = document.getElementById('settings-btn');
    settingsBtn.addEventListener('click', () => toggleModal('settings-modal', true));
    settingsBtn.setAttribute('aria-label', 'Abrir configuración');
    
    document.querySelectorAll('.close-modal-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const modal = e.target.closest('.modal');
            toggleModal(modal.id, false);
        });
        btn.setAttribute('aria-label', 'Cerrar');
    });
    
    // Cambiar título de conversación
    const editTitleBtn = document.getElementById('edit-title-btn');
    editTitleBtn.addEventListener('click', editConversationTitle);
    editTitleBtn.setAttribute('aria-label', 'Editar título');
    
    // Botón de subir documento
    const uploadDocBtn = document.getElementById('upload-document-btn');
    uploadDocBtn.addEventListener('click', () => {
        document.getElementById('document-upload-input').click();
    });
    uploadDocBtn.setAttribute('aria-label', 'Subir documento');
    
    const uploadDocSidebarBtn = document.getElementById('upload-document-sidebar-btn');
    uploadDocSidebarBtn.addEventListener('click', () => {
        document.getElementById('document-upload-input').click();
    });
    uploadDocSidebarBtn.setAttribute('aria-label', 'Subir documento');
    
    const documentUploadInput = document.getElementById('document-upload-input');
    documentUploadInput.addEventListener('change', handleDocumentUpload);
    
    // Botones de configuración
    const saveSettingsBtn = document.getElementById('save-settings-btn');
    saveSettingsBtn.addEventListener('click', saveSettings);
    saveSettingsBtn.setAttribute('aria-label', 'Guardar configuración');
    
    const resetSettingsBtn = document.getElementById('reset-settings-btn');
    resetSettingsBtn.addEventListener('click', resetSettings);
    resetSettingsBtn.setAttribute('aria-label', 'Restablecer configuración');
    
    // Slider de temperatura
    const temperatureSlider = document.getElementById('temperature-setting');
    const temperatureValue = document.getElementById('temperature-value');
    temperatureSlider.addEventListener('input', () => {
        temperatureValue.textContent = temperatureSlider.value;
    });
    temperatureSlider.setAttribute('aria-label', 'Temperatura');
    
    // Slider de max_tokens
    const maxTokensSlider = document.getElementById('max-tokens-setting');
    const maxTokensValue = document.getElementById('max-tokens-value');
    maxTokensSlider.addEventListener('input', () => {
        maxTokensValue.textContent = maxTokensSlider.value;
    });
    maxTokensSlider.setAttribute('aria-label', 'Máximo de tokens');
    
    // Botón de eliminar conversación
    const deleteConversationBtn = document.getElementById('delete-conversation-btn');
    deleteConversationBtn.addEventListener('click', confirmDeleteConversation);
    deleteConversationBtn.setAttribute('aria-label', 'Eliminar conversación');
    
    // Botón de exportar conversación
    const exportBtn = document.getElementById('export-btn');
    exportBtn.addEventListener('click', exportConversation);
    exportBtn.setAttribute('aria-label', 'Exportar conversación');
    
    // Botón de reiniciar memoria
    const clearMemoryBtn = document.getElementById('clear-memory-btn');
    clearMemoryBtn.addEventListener('click', confirmResetMemory);
    clearMemoryBtn.setAttribute('aria-label', 'Reiniciar memoria');
    
    // Botón de búsqueda en documentos
    const documentSearchBtn = document.getElementById('document-search-btn');
    documentSearchBtn.addEventListener('click', () => {
        toggleModal('document-search-modal', true);
    });
    documentSearchBtn.setAttribute('aria-label', 'Buscar en documentos');
    
    // Botón de realizar búsqueda en documentos
    const doDocumentSearchBtn = document.getElementById('do-document-search-btn');
    doDocumentSearchBtn.addEventListener('click', searchInDocuments);
    doDocumentSearchBtn.setAttribute('aria-label', 'Realizar búsqueda');
    
    // Input de búsqueda en documentos con tecla Enter
    const documentSearchInput = document.getElementById('document-search-input');
    documentSearchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            searchInDocuments();
        }
    });
    documentSearchInput.addEventListener('input', debounce(() => {
        const searchTerm = documentSearchInput.value.trim();
        if (searchTerm.length >= 3) {
            searchInDocuments();
        }
    }, DEBOUNCE_TIMEOUT));
    documentSearchInput.setAttribute('aria-label', 'Término de búsqueda');
    
    // Toggle de barra lateral derecha en móvil
    const toggleSidebarBtn = document.getElementById('toggle-sidebar-btn');
    toggleSidebarBtn.addEventListener('click', toggleRightSidebar);
    toggleSidebarBtn.setAttribute('aria-label', 'Mostrar/ocultar panel lateral');
    
    // Botón de búsqueda global
    const globalSearchBtn = document.getElementById('global-search-btn');
    if (globalSearchBtn) {
        globalSearchBtn.addEventListener('click', () => {
            toggleModal('global-search-modal', true);
        });
        globalSearchBtn.setAttribute('aria-label', 'Búsqueda global');
    }
    
    // Botón de compartir conversación
    const shareConversationBtn = document.getElementById('share-conversation-btn');
    if (shareConversationBtn) {
        shareConversationBtn.addEventListener('click', shareConversation);
        shareConversationBtn.setAttribute('aria-label', 'Compartir conversación');
    }
}

/**
 * Inicializa la biblioteca de renderizado de markdown y highlight.js
 */
function initRenderers() {
    // Configurar marked para usar highlight.js
    marked.setOptions({
        highlight: function(code, lang) {
            if (lang && hljs.getLanguage(lang)) {
                return hljs.highlight(code, { language: lang }).value;
            }
            return hljs.highlightAuto(code).value;
        },
        gfm: true,
        breaks: true,
        sanitize: true // Sanitizar HTML para evitar XSS
    });
    
    // Inicializar highlight.js
    hljs.highlightAll();
}

/**
 * Inicializa las pestañas
 */
function initTabs() {
    // Pestañas de la barra lateral
    document.querySelectorAll('.sidebar-tabs .tab-btn').forEach(btn => {
        btn.setAttribute('role', 'tab');
        btn.setAttribute('aria-selected', btn.classList.contains('active') ? 'true' : 'false');
        
        btn.addEventListener('click', (e) => {
            const tabName = e.target.dataset.tab;
            
            // Desactivar todas las pestañas
            document.querySelectorAll('.sidebar-tabs .tab-btn').forEach(b => {
                b.classList.remove('active');
                b.setAttribute('aria-selected', 'false');
            });
            document.querySelectorAll('.tab-panel').forEach(panel => {
                panel.classList.remove('active');
                panel.setAttribute('aria-hidden', 'true');
            });
            
            // Activar la pestaña seleccionada
            e.target.classList.add('active');
            e.target.setAttribute('aria-selected', 'true');
            const panel = document.getElementById(`${tabName}-tab`);
            panel.classList.add('active');
            panel.setAttribute('aria-hidden', 'false');
        });
    });
    
    // Pestañas de vista previa de documento
    document.querySelectorAll('.document-tabs .tab-btn').forEach(btn => {
        btn.setAttribute('role', 'tab');
        btn.setAttribute('aria-selected', btn.classList.contains('active') ? 'true' : 'false');
        
        btn.addEventListener('click', (e) => {
            const tabName = e.target.dataset.tab;
            
            // Desactivar todas las pestañas
            document.querySelectorAll('.document-tabs .tab-btn').forEach(b => {
                b.classList.remove('active');
                b.setAttribute('aria-selected', 'false');
            });
            document.querySelectorAll('.document-tab-content .tab-panel').forEach(panel => {
                panel.classList.remove('active');
                panel.setAttribute('aria-hidden', 'true');
            });
            
            // Activar la pestaña seleccionada
            e.target.classList.add('active');
            e.target.setAttribute('aria-selected', 'true');
            const panel = document.getElementById(`document-${tabName}-tab`);
            panel.classList.add('active');
            panel.setAttribute('aria-hidden', 'false');
        });
    });
}

/**
 * Detecta y establece preferencia de tema oscuro
 */
function detectDarkMode() {
    const darkModeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    
    const updateTheme = (isDark) => {
        if (isDark) {
            enableDarkMode();
            document.getElementById('dark-mode-setting').checked = true;
        } else {
            disableDarkMode();
            document.getElementById('dark-mode-setting').checked = false;
        }
    };
    
    // Actualizar tema basado en preferencia del usuario si no se ha configurado manualmente
    if (localStorage.getItem('darkMode') === null) {
        updateTheme(darkModeMediaQuery.matches);
    }
    
    // Escuchar cambios de tema del sistema
    darkModeMediaQuery.addEventListener('change', (e) => {
        // Solo actualizar si el usuario no ha configurado manualmente
        if (localStorage.getItem('darkMode') === null) {
            updateTheme(e.matches);
        }
    });
    
    // Botón de tema oscuro
    document.getElementById('dark-mode-setting').addEventListener('change', (e) => {
        if (e.target.checked) {
            enableDarkMode();
            localStorage.setItem('darkMode', 'true');
        } else {
            disableDarkMode();
            localStorage.setItem('darkMode', 'false');
        }
    });
}

/**
 * Habilita el modo oscuro y ajusta los colores para mejorar el contraste
 */
function enableDarkMode() {
    document.body.classList.add('dark-mode');
    document.documentElement.style.setProperty('--text-color', '#ffffff');
    document.documentElement.style.setProperty('--background-color', '#121212');
    document.documentElement.style.setProperty('--primary-color', '#4db6ac');
    document.documentElement.style.setProperty('--secondary-color', '#b39ddb');
    document.documentElement.style.setProperty('--accent-color', '#ff6e40');
    currentSettings.darkMode = true;
}

/**
 * Deshabilita el modo oscuro y restaura los colores por defecto
 */
function disableDarkMode() {
    document.body.classList.remove('dark-mode');
    document.documentElement.style.setProperty('--text-color', '#212121');
    document.documentElement.style.setProperty('--background-color', '#ffffff');
    document.documentElement.style.setProperty('--primary-color', '#26a69a');
    document.documentElement.style.setProperty('--secondary-color', '#7e57c2');
    document.documentElement.style.setProperty('--accent-color', '#ff5722');
    currentSettings.darkMode = false;
}

/**
 * Inicializa la detección de conexión a internet
 */
function initConnectionDetection() {
    // Verificar estado inicial de la conexión
    lastNetworkStatus = navigator.onLine;
    
    // Escuchar cambios en la conexión
    window.addEventListener('online', handleOnlineStatus);
    window.addEventListener('offline', handleOfflineStatus);
}

/**
 * Maneja el evento cuando se recupera la conexión
 */
function handleOnlineStatus() {
    if (!lastNetworkStatus) {
        lastNetworkStatus = true;
        showToast(TOAST_TYPES.SUCCESS, 'Conexión restablecida', 'Se ha restablecido la conexión al servidor');
        
        // Intentar reconectar y refrescar datos
        reconnectToServer();
    }
}

/**
 * Maneja el evento cuando se pierde la conexión
 */
function handleOfflineStatus() {
    lastNetworkStatus = false;
    showToast(TOAST_TYPES.WARNING, 'Sin conexión', 'Se ha perdido la conexión a internet', 0);
    updateSystemStatusError();
}

/**
 * Intenta reconectar al servidor y recargar los datos
 * @async
 */
async function reconnectToServer() {
    if (isReconnecting) return;
    
    try {
        isReconnecting = true;
        reconnectAttempts = 0;
        
        // Intentar reconectar al servidor
        while (reconnectAttempts < MAX_RETRY_ATTEMPTS) {
            reconnectAttempts++;
            
            try {
                // Comprobar estado del sistema
                await checkSystemStatus();
                
                // Si llegamos aquí, la reconexión fue exitosa
                if (currentConversationId) {
                    // Recargar conversación actual
                    await loadConversation(currentConversationId);
                } else {
                    // Recargar lista de conversaciones
                    await loadConversations();
                }
                
                hideAllToasts();
                showToast(TOAST_TYPES.SUCCESS, 'Reconectado', 'Se ha restablecido la conexión al servidor');
                break;
            } catch (error) {
                console.error('Error al reconectar (intento ' + reconnectAttempts + '):', error);
                
                if (reconnectAttempts >= MAX_RETRY_ATTEMPTS) {
                    throw new Error('No se pudo reconectar después de varios intentos');
                }
                
                // Esperar antes del siguiente intento
                await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * reconnectAttempts));
            }
        }
    } catch (error) {
        console.error('Error en la reconexión:', error);
        showToast(TOAST_TYPES.ERROR, 'Error de reconexión', 'No se pudo restablecer la conexión. Intente recargar la página.');
    } finally {
        isReconnecting = false;
    }
}

/**
 * Inicializa la virtualización para listas largas
 */
function initVirtualization() {
    // Configurar observador para contenedor de mensajes
    const messageContainer = document.getElementById('message-container');
    
    // Crear un ResizeObserver para el contenedor de mensajes
    const resizeObserver = new ResizeObserver(entries => {
        for (const entry of entries) {
            if (entry.target === messageContainer) {
                // Solo actualizar virtualización si hay muchos mensajes
                if (allMessages.length > MESSAGE_VIRTUALIZATION_THRESHOLD) {
                    updateVirtualizedMessages();
                }
            }
        }
    });
    
    // Observar cambios en el tamaño
    resizeObserver.observe(messageContainer);
    
    // Manejar scroll para virtualización
    messageContainer.addEventListener('scroll', debounce(() => {
        if (allMessages.length > MESSAGE_VIRTUALIZATION_THRESHOLD) {
            updateVirtualizedMessages();
        }
    }, 100));
}

/**
 * Actualiza los mensajes virtualizados según la posición de scroll
 */
function updateVirtualizedMessages() {
    const messageContainer = document.getElementById('message-container');
    if (!messageContainer) return;
    
    // Solo proceder si hay suficientes mensajes para virtualizar
    if (allMessages.length <= MESSAGE_VIRTUALIZATION_THRESHOLD) {
        return;
    }
    
    const containerRect = messageContainer.getBoundingClientRect();
    const visibleTop = messageContainer.scrollTop;
    const visibleBottom = visibleTop + containerRect.height;
    const bufferSize = 5; // Número de mensajes adicionales arriba/abajo para un scroll suave
    
    // Calcular qué mensajes deberían ser visibles
    const newVisibleIds = new Set();
    let approximateTop = 0;
    const averageHeight = 120; // Altura aproximada de un mensaje en píxeles
    
    for (let i = 0; i < allMessages.length; i++) {
        const approximateBottom = approximateTop + averageHeight;
        
        // Si este mensaje está visible o en el buffer
        if ((approximateBottom >= visibleTop - bufferSize * averageHeight) && 
            (approximateTop <= visibleBottom + bufferSize * averageHeight)) {
            newVisibleIds.add(allMessages[i].id);
        }
        
        approximateTop = approximateBottom;
    }
    
    // Crear/eliminar elementos del DOM según necesidad
    allMessages.forEach(message => {
        const id = message.id;
        const isCurrentlyVisible = virtualizedMessageIds.has(id);
        const shouldBeVisible = newVisibleIds.has(id);
        
        if (!isCurrentlyVisible && shouldBeVisible) {
            // Crear y añadir elemento
            if (message.role === 'system') {
                displaySystemMessage(message);
            } else {
                displayChatMessage(message);
            }
            virtualizedMessageIds.add(id);
        } else if (isCurrentlyVisible && !shouldBeVisible) {
            // Eliminar elemento
            const messageElement = document.getElementById(`message-${id}`);
            if (messageElement) {
                messageElement.remove();
                virtualizedMessageIds.delete(id);
            }
        }
    });
}

/**
 * Inicializa mejoras de accesibilidad
 */
function initAccessibility() {
    // Añadir roles y atributos ARIA a elementos principales
    document.querySelector('.left-sidebar').setAttribute('role', 'navigation');
    document.querySelector('.left-sidebar').setAttribute('aria-label', 'Conversaciones');
    
    document.querySelector('.chat-container').setAttribute('role', 'main');
    document.querySelector('.right-sidebar').setAttribute('role', 'complementary');
    document.querySelector('.right-sidebar').setAttribute('aria-label', 'Información contextual');
    
    document.getElementById('message-container').setAttribute('role', 'log');
    document.getElementById('message-container').setAttribute('aria-live', 'polite');
    
    // Añadir navegación por teclado para la lista de conversaciones
    const conversationList = document.getElementById('conversation-list');
    conversationList.setAttribute('role', 'list');
    conversationList.setAttribute('tabindex', '0');
    
    conversationList.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            
            const items = Array.from(conversationList.querySelectorAll('.conversation-item'));
            if (items.length === 0) return;
            
            // Encontrar el elemento actualmente enfocado o el primero
            const currentFocusIndex = items.findIndex(item => item === document.activeElement);
            let nextIndex;
            
            if (e.key === 'ArrowDown') {
                nextIndex = (currentFocusIndex < 0 || currentFocusIndex >= items.length - 1) ? 0 : currentFocusIndex + 1;
            } else {
                nextIndex = (currentFocusIndex <= 0) ? items.length - 1 : currentFocusIndex - 1;
            }
            
            // Enfocar el siguiente elemento
            items[nextIndex].focus();
        } else if (e.key === 'Enter' && document.activeElement.classList.contains('conversation-item')) {
            // Cargar la conversación al presionar Enter
            document.activeElement.click();
        }
    });
    
    // Añadir navegación por teclado para documentos
    const documentList = document.getElementById('document-list');
    documentList.setAttribute('role', 'list');
    documentList.setAttribute('tabindex', '0');
    
    documentList.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            
            const items = Array.from(documentList.querySelectorAll('.document-item'));
            if (items.length === 0) return;
            
            const currentFocusIndex = items.findIndex(item => item === document.activeElement);
            let nextIndex;
            
            if (e.key === 'ArrowDown') {
                nextIndex = (currentFocusIndex < 0 || currentFocusIndex >= items.length - 1) ? 0 : currentFocusIndex + 1;
            } else {
                nextIndex = (currentFocusIndex <= 0) ? items.length - 1 : currentFocusIndex - 1;
            }
            
            items[nextIndex].focus();
        } else if (e.key === 'Enter' && document.activeElement.classList.contains('document-item')) {
            document.activeElement.click();
        }
    });
}

/**
 * Obtiene el token CSRF del servidor
 * @async
 */
async function fetchCSRFToken() {
    try {
        const response = await fetchWithTimeout('/api/csrf-token');
        if (response.ok) {
            const data = await response.json();
            csrfToken = data.token;
        }
    } catch (error) {
        console.error('Error al obtener token CSRF:', error);
    }
}

// ===== GESTIÓN DE CONVERSACIONES =====

/**
 * Carga la lista de conversaciones desde el servidor
 * @async
 */
async function loadConversations() {
    try {
        const response = await fetchWithRetry('/api/conversations');
        
        if (!response.ok) {
            throw new Error(ERROR_MESSAGES.LOAD_CONVERSATIONS);
        }
        
        const data = await response.json();
        displayConversations(data.conversations);
        
        // Si no hay conversación activa, crear una nueva
        if (!currentConversationId && data.conversations.length === 0) {
            await createNewConversation();
        } else if (!currentConversationId && data.conversations.length > 0) {
            // Cargar la conversación más reciente
            await loadConversation(data.conversations[0].id);
        }
    } catch (error) {
        console.error('Error:', error);
        showToast(TOAST_TYPES.ERROR, 'Error', ERROR_MESSAGES.LOAD_CONVERSATIONS);
    }
}

/**
 * Muestra la lista de conversaciones en la interfaz
 * @param {Array} conversations - Lista de conversaciones a mostrar
 */
function displayConversations(conversations) {
    const conversationList = document.getElementById('conversation-list');
    conversationList.innerHTML = '';
    
    // Ordenar conversaciones por fecha (más recientes primero)
    conversations.sort((a, b) => {
        const dateA = new Date(a.lastActive || a.created_at);
        const dateB = new Date(b.lastActive || b.created_at);
        return dateB - dateA;
    });
    
    // Si no hay conversaciones, mostrar mensaje
    if (conversations.length === 0) {
        const emptyMessage = document.createElement('li');
        emptyMessage.className = 'empty-message';
        emptyMessage.textContent = 'No hay conversaciones';
        emptyMessage.setAttribute('role', 'status');
        conversationList.appendChild(emptyMessage);
        return;
    }
    
    // Crear elementos para cada conversación
    conversations.forEach(conversation => {
        const li = document.createElement('li');
        li.className = 'conversation-item';
        li.setAttribute('role', 'listitem');
        li.setAttribute('tabindex', '0');
        li.setAttribute('aria-selected', conversation.id === currentConversationId ? 'true' : 'false');
        
        if (conversation.id === currentConversationId) {
            li.classList.add('active');
        }
        
        const date = new Date(conversation.lastActive || conversation.created_at);
        const formattedDate = formatDate(date);
        
        li.innerHTML = `
            <div class="conversation-item-title">${escapeHTML(conversation.title || 'Sin título')}</div>
            <div class="conversation-item-date">${formattedDate}</div>
        `;
        
        li.addEventListener('click', () => loadConversation(conversation.id));
        li.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                loadConversation(conversation.id);
            }
        });
        
        conversationList.appendChild(li);
    });
}

/**
 * Carga una conversación específica
 * @async
 * @param {string} conversationId - ID de la conversación a cargar
 */
async function loadConversation(conversationId) {
    try {
        // Si ya estaba cargada, no hacer nada
        if (currentConversationId === conversationId) {
            return;
        }
        
        // Mostrar indicador de carga
        const messageContainer = document.getElementById('message-container');
        messageContainer.innerHTML = `
            <div class="loading-message" role="status" aria-live="polite">
                <div class="loader"></div>
                <div>Cargando conversación...</div>
            </div>
        `;
        
        const response = await fetchWithRetry(`/api/conversations/${conversationId}`);
        
        if (!response.ok) {
            throw new Error(ERROR_MESSAGES.LOAD_CONVERSATION);
        }
        
        const conversation = await response.json();
        
        // Actualizar conversación actual
        currentConversationId = conversationId;
        
        // Actualizar título
        document.getElementById('conversation-title').textContent = conversation.title || 'Sin título';
        
        // Actualizar clase active en la lista
        document.querySelectorAll('.conversation-item').forEach(item => {
            item.classList.remove('active');
            item.setAttribute('aria-selected', 'false');
        });
        document.querySelectorAll('.conversation-item').forEach(item => {
            if (item.querySelector('.conversation-item-title').textContent === conversation.title) {
                item.classList.add('active');
                item.setAttribute('aria-selected', 'true');
            }
        });
        
        // Limpiar caché de virtualización
        allMessages = conversation.messages || [];
        virtualizedMessageIds.clear();
        
        // Asignar IDs a los mensajes si no los tienen
        allMessages.forEach((message, index) => {
            if (!message.id) {
                message.id = `msg-${Date.now()}-${index}`;
            }
        });
        
        // Mostrar mensajes
        if (allMessages.length > MESSAGE_VIRTUALIZATION_THRESHOLD) {
            // Usar virtualización para muchos mensajes
            displayVirtualizedMessages(allMessages);
        } else {
            // Mostrar todos los mensajes
            displayMessages(allMessages);
        }
        
        // Cargar documentos de la conversación
        loadConversationDocuments(conversationId);
        
        // Cargar información de contexto
        loadContextInfo(conversationId);
        
        // Habilitar controles
        document.getElementById('message-input').disabled = false;
        document.getElementById('send-btn').disabled = false;
        document.getElementById('upload-document-btn').disabled = false;
    } catch (error) {
        console.error('Error:', error);
        showToast(TOAST_TYPES.ERROR, 'Error', ERROR_MESSAGES.LOAD_CONVERSATION);
    }
}

/**
 * Muestra mensajes virtualizados (para conversaciones largas)
 * @param {Array} messages - Lista de mensajes a virtualizar
 */
function displayVirtualizedMessages(messages) {
    const messageContainer = document.getElementById('message-container');
    messageContainer.innerHTML = '';
    
    if (!messages || messages.length === 0) {
        messageContainer.innerHTML = `
            <div class="welcome-message" role="status">
                <h2>Bienvenido a CAG Chat</h2>
                <p>Conversa con Gemma 3 potenciado con Augmentación Contextual.</p>
                <p>Puedes subir documentos para enriquecer el contexto y obtener respuestas más precisas.</p>
            </div>
        `;
        return;
    }
    
    // Crear placeholders para todos los mensajes
    messages.forEach(message => {
        const placeholder = document.createElement('div');
        placeholder.id = `message-placeholder-${message.id}`;
        placeholder.className = 'message-placeholder';
        placeholder.style.height = (message.role === 'system' ? '50px' : '120px');
        messageContainer.appendChild(placeholder);
    });
    
    // Inicializar virtualización
    updateVirtualizedMessages();
    
    // Scroll al final
    if (currentSettings.autoScroll) {
        scrollToBottom();
    }
}

/**
 * Muestra todos los mensajes (para conversaciones cortas)
 * @param {Array} messages - Lista de mensajes a mostrar
 */
function displayMessages(messages) {
    const messageContainer = document.getElementById('message-container');
    messageContainer.innerHTML = '';
    
    if (!messages || messages.length === 0) {
        messageContainer.innerHTML = `
            <div class="welcome-message" role="status">
                <h2>Bienvenido a CAG Chat</h2>
                <p>Conversa con Gemma 3 potenciado con Augmentación Contextual.</p>
                <p>Puedes subir documentos para enriquecer el contexto y obtener respuestas más precisas.</p>
            </div>
        `;
        return;
    }
    
    messages.forEach(message => {
        if (message.role === 'system') {
            displaySystemMessage(message);
        } else {
            displayChatMessage(message);
        }
    });
    
    // Scroll al final
    if (currentSettings.autoScroll) {
        scrollToBottom();
    }
}

/**
 * Muestra un mensaje de sistema
 * @param {Object} message - Mensaje a mostrar
 */
function displaySystemMessage(message) {
    const messageContainer = document.getElementById('message-container');
    
    const systemMessage = document.createElement('div');
    systemMessage.className = 'system-message';
    systemMessage.id = `message-${message.id}`;
    systemMessage.setAttribute('role', 'status');
    
    if (message.content.includes('Documento subido:')) {
        // Mensaje de documento subido
        systemMessage.innerHTML = `
            <div class="system-message-content">
                <i class="fas fa-file-upload" aria-hidden="true"></i> ${escapeHTML(message.content)}
            </div>
        `;
    } else {
        // Otro tipo de mensaje de sistema
        systemMessage.innerHTML = `
            <div class="system-message-content">
                <i class="fas fa-info-circle" aria-hidden="true"></i> ${escapeHTML(message.content)}
            </div>
        `;
    }
    
    messageContainer.appendChild(systemMessage);
}

/**
 * Muestra un mensaje de chat
 * @param {Object} message - Mensaje a mostrar
 */
function displayChatMessage(message) {
    const messageContainer = document.getElementById('message-container');
    
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${message.role}`;
    messageDiv.id = `message-${message.id}`;
    messageDiv.setAttribute('role', message.role === 'user' ? 'complementary' : 'article');
    
    const date = new Date(message.timestamp);
    const formattedTime = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    // Procesar contenido con markdown para mensajes del bot
    let processedContent = message.content;
    if (message.role === 'bot') {
        processedContent = marked.parse(processedContent);
    } else {
        processedContent = escapeHTML(processedContent).replace(/\n/g, '<br>');
    }
    
    messageDiv.innerHTML = `
        <div class="message-bubble">
            <div class="message-content">${processedContent}</div>
            <div class="message-meta">
                <span class="message-time">${formattedTime}</span>
                <div class="message-buttons">
                    <button class="message-button copy-btn" title="Copiar al portapapeles" aria-label="Copiar texto">
                        <i class="fas fa-copy" aria-hidden="true"></i>
                    </button>
                </div>
            </div>
        </div>
    `;
    
    // Botón de copiar
    messageDiv.querySelector('.copy-btn').addEventListener('click', () => {
        navigator.clipboard.writeText(message.content).then(() => {
            showToast(TOAST_TYPES.SUCCESS, 'Copiado', SUCCESS_MESSAGES.TEXT_COPIED);
        }).catch(() => {
            showToast(TOAST_TYPES.ERROR, 'Error', 'No se pudo copiar el texto');
        });
    });
    
    messageContainer.appendChild(messageDiv);
    
    // Resaltar código si es un mensaje del bot
    if (message.role === 'bot') {
        messageDiv.querySelectorAll('pre code').forEach(block => {
            hljs.highlightElement(block);
        });
    }
}

/**
 * Crea una nueva conversación
 * @async
 */
async function createNewConversation() {
    try {
        const response = await fetchWithRetry('/api/conversations', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': csrfToken
            },
            body: JSON.stringify({
                title: 'Nueva conversación'
            })
        });
        
        if (!response.ok) {
            throw new Error(ERROR_MESSAGES.CREATE_CONVERSATION);
        }
        
        const newConversation = await response.json();
        
        // Actualizar lista de conversaciones
        await loadConversations();
        
        // Cargar la nueva conversación
        await loadConversation(newConversation.id);
        
        showToast(TOAST_TYPES.SUCCESS, 'Conversación creada', SUCCESS_MESSAGES.CONVERSATION_CREATED);
    } catch (error) {
        console.error('Error:', error);
        showToast(TOAST_TYPES.ERROR, 'Error', ERROR_MESSAGES.CREATE_CONVERSATION);
    }
}

/**
 * Envía un mensaje a la conversación actual
 * @async
 */
async function sendMessage() {
    try {
        const messageInput = document.getElementById('message-input');
        const messageText = messageInput.value.trim();
        const sendBtn = document.getElementById('send-btn');
        
        // Validar
        if (!messageText || isPendingResponse) {
            return;
        }
        
        // Validar conversación
        if (!currentConversationId) {
            await createNewConversation();
        }
        
        // Deshabilitar input y botón mientras se envía
        messageInput.disabled = true;
        sendBtn.disabled = true;
        isPendingResponse = true;
        
        // Limpiar input
        messageInput.value = '';
        
        // Enviar mensaje al servidor
        const messageResponse = await fetchWithRetry(`/api/conversations/${currentConversationId}/messages`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': csrfToken
            },
            body: JSON.stringify({
                role: 'user',
                content: messageText
            })
        });
        
        if (!messageResponse.ok) {
            throw new Error(ERROR_MESSAGES.SEND_MESSAGE);
        }
        
        const messageData = await messageResponse.json();
        
        // Actualizar título si cambió
        if (messageData.title) {
            document.getElementById('conversation-title').textContent = messageData.title;
        }
        
        // Crear ID único para el mensaje
        const userMessageId = `msg-${Date.now()}-user`;
        
        // Añadir mensaje a la caché de mensajes
        const userMessage = {
            id: userMessageId,
            role: 'user',
            content: messageText,
            timestamp: new Date().toISOString()
        };
        allMessages.push(userMessage);
        
        // Mostrar mensaje del usuario
        displayChatMessage(userMessage);
        
        // Mostrar indicador de escritura
        const messageContainer = document.getElementById('message-container');
        const typingIndicator = document.createElement('div');
        typingIndicator.className = 'message bot typing';
        typingIndicator.setAttribute('role', 'status');
        typingIndicator.setAttribute('aria-label', 'El asistente está escribiendo');
        typingIndicator.innerHTML = `
            <div class="message-bubble">
                <div class="typing-indicator">
                    <span></span>
                    <span></span>
                    <span></span>
                </div>
            </div>
        `;
        messageContainer.appendChild(typingIndicator);
        
        // Scroll al final
        if (currentSettings.autoScroll) {
            scrollToBottom();
        }
        
        // Generar respuesta
        const generateResponse = await fetchWithRetry('/api/generate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': csrfToken
            },
            body: JSON.stringify({
                conversation_id: currentConversationId,
                config: {
                    temperature: parseFloat(currentSettings.temperature),
                    max_tokens: parseInt(currentSettings.max_tokens),
                    system_prompt: currentSettings.system_prompt,
                    memory_enabled: currentSettings.memoryEnabled,
                    global_memory: currentSettings.globalMemoryEnabled,
                    model: currentSettings.model
                }
            })
        });
        
        // Eliminar indicador de escritura
        if (typingIndicator) {
            typingIndicator.remove();
        }
        
        if (!generateResponse.ok) {
            throw new Error(`Error al generar respuesta: ${generateResponse.status} ${generateResponse.statusText}`);
        }
        
        const responseData = await generateResponse.json();
        
        // Crear ID único para la respuesta
        const botMessageId = `msg-${Date.now()}-bot`;
        
        // Añadir respuesta a la caché de mensajes
        const botMessage = {
            id: botMessageId,
            role: 'bot',
            content: responseData.content,
            timestamp: responseData.timestamp
        };
        allMessages.push(botMessage);
        
        // Mostrar respuesta
        displayChatMessage(botMessage);
        
        // Actualizar título si cambió
        if (responseData.title) {
            document.getElementById('conversation-title').textContent = responseData.title;
            
            // Actualizar lista de conversaciones
            await loadConversations();
        }
        
        // Actualizar información de contexto
        loadContextInfo(currentConversationId);
    } catch (error) {
        console.error('Error:', error);
        showToast(TOAST_TYPES.ERROR, 'Error', ERROR_MESSAGES.SEND_MESSAGE);
    } finally {
        // Restablecer estado
        const messageInput = document.getElementById('message-input');
        const sendBtn = document.getElementById('send-btn');
        messageInput.disabled = false;
        sendBtn.disabled = false;
        messageInput.focus();
        isPendingResponse = false;
    }
}

/**
 * Maneja el input del campo de mensaje (debounce aplicado)
 * @param {Event} e - Evento de input
 */
function handleMessageInput(e) {
    const messageText = e.target.value.trim();
    const sendBtn = document.getElementById('send-btn');
    
    if (messageText) {
        sendBtn.disabled = false;
    } else {
        sendBtn.disabled = true;
    }
    
    // Ajustar altura del textarea
    e.target.style.height = 'auto';
    e.target.style.height = (e.target.scrollHeight) + 'px';
}

/**
 * Edita el título de la conversación actual
 */
function editConversationTitle() {
    if (!currentConversationId) return;
    
    const currentTitle = document.getElementById('conversation-title').textContent;
    
    // Crear un input inline en lugar de usar prompt
    const titleElement = document.getElementById('conversation-title');
    const originalTitle = titleElement.textContent;
    
    // Guardar el título actual y reemplazar con un input
    const inputElement = document.createElement('input');
    inputElement.type = 'text';
    inputElement.value = originalTitle;
    inputElement.className = 'inline-edit-title';
    inputElement.setAttribute('aria-label', 'Editar título de la conversación');
    
    // Reemplazar el título con el input
    titleElement.textContent = '';
    titleElement.appendChild(inputElement);
    
    // Enfocar el input
    inputElement.focus();
    inputElement.select();
    
    // Manejar eventos
    inputElement.addEventListener('blur', finishEdit);
    inputElement.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            finishEdit();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            titleElement.textContent = originalTitle;
        }
    });
    
    function finishEdit() {
        const newTitle = inputElement.value.trim();
        if (newTitle && newTitle !== originalTitle) {
            updateConversationTitle(newTitle);
        } else {
            titleElement.textContent = originalTitle;
        }
    }
}

/**
 * Actualiza el título de la conversación en el servidor
 * @async
 * @param {string} newTitle - Nuevo título para la conversación
 */
async function updateConversationTitle(newTitle) {
    try {
        const response = await fetchWithRetry(`/api/conversations/${currentConversationId}/title`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': csrfToken
            },
            body: JSON.stringify({
                title: newTitle
            })
        });
        
        if (!response.ok) {
            throw new Error('Error al actualizar título');
        }
        
        const data = await response.json();
        
        // Actualizar título en la interfaz
        document.getElementById('conversation-title').textContent = data.title;
        
        // Recargar lista de conversaciones para actualizar
        await loadConversations();
        
        showToast(TOAST_TYPES.SUCCESS, 'Título actualizado', 'El título de la conversación ha sido actualizado');
    } catch (error) {
        console.error('Error:', error);
        showToast(TOAST_TYPES.ERROR, 'Error', 'No se pudo actualizar el título');
    }
}

/**
 * Solicita confirmación para eliminar la conversación actual
 */
function confirmDeleteConversation() {
    if (!currentConversationId) return;
    
    // Usar un modal de confirmación en lugar de confirm
    const confirmModal = document.createElement('div');
    confirmModal.className = 'modal confirmation-modal';
    confirmModal.id = 'delete-confirmation-modal';
    confirmModal.setAttribute('role', 'dialog');
    confirmModal.setAttribute('aria-labelledby', 'delete-confirm-title');
    confirmModal.setAttribute('aria-modal', 'true');
    
    confirmModal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h3 id="delete-confirm-title">Confirmar eliminación</h3>
                <button class="close-modal-btn" aria-label="Cerrar">&times;</button>
            </div>
            <div class="modal-body">
                <p>¿Estás seguro de que deseas eliminar esta conversación? Esta acción no se puede deshacer.</p>
            </div>
            <div class="modal-footer">
                <button id="cancel-delete-btn" class="secondary-btn">Cancelar</button>
                <button id="confirm-delete-btn" class="danger-btn">Eliminar</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(confirmModal);
    
    // Mostrar modal
    setTimeout(() => {
        confirmModal.classList.add('active');
        document.getElementById('confirm-delete-btn').focus();
    }, 10);
    
    // Eventos
    document.getElementById('confirm-delete-btn').addEventListener('click', () => {
        confirmModal.classList.remove('active');
        setTimeout(() => {
            confirmModal.remove();
            deleteConversation();
        }, 300);
    });
    
    const cancelAction = () => {
        confirmModal.classList.remove('active');
        setTimeout(() => confirmModal.remove(), 300);
    };
    
    document.getElementById('cancel-delete-btn').addEventListener('click', cancelAction);
    confirmModal.querySelector('.close-modal-btn').addEventListener('click', cancelAction);
}

/**
 * Elimina la conversación actual
 * @async
 */
async function deleteConversation() {
    try {
        const conversationId = currentConversationId;
        
        const response = await fetchWithRetry(`/api/conversations/${conversationId}`, {
            method: 'DELETE',
            headers: {
                'X-CSRF-Token': csrfToken
            }
        });
        
        if (!response.ok) {
            throw new Error(ERROR_MESSAGES.DELETE_CONVERSATION);
        }
        
        // Resetear conversación actual
        currentConversationId = null;
        
        // Recargar lista de conversaciones
        await loadConversations();
        
        showToast(TOAST_TYPES.SUCCESS, 'Conversación eliminada', SUCCESS_MESSAGES.CONVERSATION_DELETED);
    } catch (error) {
        console.error('Error:', error);
        showToast(TOAST_TYPES.ERROR, 'Error', ERROR_MESSAGES.DELETE_CONVERSATION);
    }
}

/**
 * Exporta la conversación actual
 * @param {string} format - Formato de exportación (default: 'json')
 */
function exportConversation(format = 'json') {
    if (!currentConversationId) return;
    
    // Si se está exportando a otro formato que no sea JSON
    if (format !== 'json') {
        window.open(`/api/conversations/${currentConversationId}/export?format=${format}`, '_blank');
        return;
    }
    
    // Exportación por defecto (JSON)
    window.open(`/api/conversations/${currentConversationId}/export`, '_blank');
}

/**
 * Comparte la conversación actual generando un enlace
 * @async
 */
async function shareConversation() {
    if (!currentConversationId) return;
    
    try {
        const response = await fetchWithRetry(`/api/conversations/${currentConversationId}/share`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': csrfToken
            }
        });
        
        if (!response.ok) {
            throw new Error('Error al compartir conversación');
        }
        
        const data = await response.json();
        const shareUrl = `${window.location.origin}/shared/${data.shareId}`;
        
        // Mostrar modal con enlace compartido
        const shareModal = document.createElement('div');
        shareModal.className = 'modal share-modal';
        shareModal.id = 'share-modal';
        shareModal.setAttribute('role', 'dialog');
        shareModal.setAttribute('aria-labelledby', 'share-title');
        
        shareModal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h3 id="share-title">Compartir conversación</h3>
                    <button class="close-modal-btn" aria-label="Cerrar">&times;</button>
                </div>
                <div class="modal-body">
                    <p>Enlace para compartir esta conversación:</p>
                    <div class="share-link-container">
                        <input type="text" id="share-link-input" value="${shareUrl}" readonly />
                        <button id="copy-share-link-btn" class="primary-btn" aria-label="Copiar enlace">
                            <i class="fas fa-copy"></i> Copiar
                        </button>
                    </div>
                    <div class="share-options">
                        <label class="expiry-label">
                            Expira en: 
                            <select id="expiry-select">
                                <option value="1">1 día</option>
                                <option value="7" selected>7 días</option>
                                <option value="30">30 días</option>
                                <option value="0">Nunca</option>
                            </select>
                        </label>
                    </div>
                </div>
            </div>
        `;
        
        document.body.appendChild(shareModal);
        
        // Mostrar modal
        setTimeout(() => {
            shareModal.classList.add('active');
            document.getElementById('share-link-input').select();
        }, 10);
        
        // Eventos
        document.getElementById('copy-share-link-btn').addEventListener('click', () => {
            const shareInput = document.getElementById('share-link-input');
            shareInput.select();
            navigator.clipboard.writeText(shareInput.value).then(() => {
                showToast(TOAST_TYPES.SUCCESS, 'Enlace copiado', 'Enlace copiado al portapapeles');
            });
        });
        
        document.getElementById('expiry-select').addEventListener('change', async (e) => {
            try {
                const days = parseInt(e.target.value);
                
                const updateResponse = await fetchWithRetry(`/api/conversations/${currentConversationId}/share`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRF-Token': csrfToken
                    },
                    body: JSON.stringify({
                        expiryDays: days
                    })
                });
                
                if (!updateResponse.ok) {
                    throw new Error('Error al actualizar expiración');
                }
                
                showToast(TOAST_TYPES.SUCCESS, 'Expiración actualizada', 'Se ha actualizado el período de expiración');
            } catch (error) {
                console.error('Error:', error);
                showToast(TOAST_TYPES.ERROR, 'Error', 'No se pudo actualizar la expiración');
            }
        });
        
        shareModal.querySelector('.close-modal-btn').addEventListener('click', () => {
            shareModal.classList.remove('active');
            setTimeout(() => shareModal.remove(), 300);
        });
    } catch (error) {
        console.error('Error:', error);
        showToast(TOAST_TYPES.ERROR, 'Error', 'No se pudo compartir la conversación');
    }
}

// ===== GESTIÓN DE DOCUMENTOS =====

/**
 * Maneja la subida de documentos
 * @async
 * @param {Event} e - Evento de cambio del input file
 */
async function handleDocumentUpload(e) {
    if (!currentConversationId || documentUploadPending) return;
    
    const file = e.target.files[0];
    if (!file) return;
    
    try {
        // Validar tipo de archivo
        if (!validateFileType(file)) {
            showToast(TOAST_TYPES.ERROR, 'Tipo de archivo no válido', ERROR_MESSAGES.INVALID_FILE_TYPE);
            return;
        }
        
        documentUploadPending = true;
        
        // Mostrar notificación de carga
        const uploadToast = showToast(TOAST_TYPES.INFO, 'Subiendo documento', 'El documento está siendo procesado...', 0);
        
        // Crear FormData con el archivo y datos adicionales
        const formData = new FormData();
        formData.append('document', file);
        
        const response = await fetchWithRetry(`/api/conversations/${currentConversationId}/documents`, {
            method: 'POST',
            headers: {
                'X-CSRF-Token': csrfToken
            },
            body: formData
        }, 5); // Más reintentos para subidas de archivos
        
        // Cerrar notificación de carga
        if (uploadToast) {
            uploadToast.classList.add('closing');
            setTimeout(() => {
                if (uploadToast.parentNode) {
                    uploadToast.remove();
                }
            }, 300);
        }
        
        if (!response.ok) {
            throw new Error(ERROR_MESSAGES.UPLOAD_DOCUMENT);
        }
        
        const data = await response.json();
        
        // Actualizar lista de documentos
        loadConversationDocuments(currentConversationId);
        
        // Actualizar mensajes para mostrar notificación de documento subido
        loadConversation(currentConversationId);
        
        showToast(TOAST_TYPES.SUCCESS, 'Documento subido', `${file.name} ${SUCCESS_MESSAGES.DOCUMENT_UPLOADED}`);
    } catch (error) {
        console.error('Error:', error);
        showToast(TOAST_TYPES.ERROR, 'Error', ERROR_MESSAGES.UPLOAD_DOCUMENT);
    } finally {
        documentUploadPending = false;
        e.target.value = ''; // Resetear input file
    }
}

/**
 * Valida el tipo de archivo subido
 * @param {File} file - Archivo a validar
 * @returns {boolean} - true si el tipo es válido, false si no
 */
function validateFileType(file) {
    // Comprobar por extensión si el tipo MIME no es fiable
    const fileName = file.name.toLowerCase();
    const fileExtension = fileName.substring(fileName.lastIndexOf('.') + 1);
    
    // Lista de extensiones permitidas
    const allowedExtensions = ['pdf', 'docx', 'doc', 'txt', 'md', 'csv', 'json', 'xls', 'xlsx'];
    
    // Validar por MIME type
    if (ALLOWED_FILE_TYPES.includes(file.type)) {
        return true;
    }
    
    // Si el MIME type no es reconocido, validar por extensión
    return allowedExtensions.includes(fileExtension);
}

/**
 * Carga los documentos de una conversación
 * @async
 * @param {string} conversationId - ID de la conversación
 */
async function loadConversationDocuments(conversationId) {
    try {
        const response = await fetchWithRetry(`/api/conversations/${conversationId}/documents`);
        
        if (!response.ok) {
            throw new Error(ERROR_MESSAGES.LOAD_DOCUMENTS);
        }
        
        const documents = await response.json();
        displayDocuments(documents);
    } catch (error) {
        console.error('Error:', error);
        const documentList = document.getElementById('document-list');
        documentList.innerHTML = `<li class="empty-message" role="status">Error al cargar documentos</li>`;
    }
}

/**
 * Muestra la lista de documentos en la interfaz
 * @param {Array} documents - Lista de documentos a mostrar
 */
function displayDocuments(documents) {
    const documentList = document.getElementById('document-list');
    documentList.innerHTML = '';
    
    if (!documents || documents.length === 0) {
        documentList.innerHTML = '<li class="empty-message" role="status">No hay documentos subidos aún.</li>';
        return;
    }
    
    // Ordenar documentos por fecha (más recientes primero)
    documents.sort((a, b) => {
        const dateA = new Date(a.uploadDate);
        const dateB = new Date(b.uploadDate);
        return dateB - dateA;
    });
    
    documents.forEach(doc => {
        const li = document.createElement('li');
        li.className = 'document-item';
        li.setAttribute('role', 'listitem');
        li.setAttribute('tabindex', '0');
        
        // Determinar icono según formato
        let icon = 'fa-file';
        if (doc.format === 'pdf') icon = 'fa-file-pdf';
        else if (doc.format === 'docx') icon = 'fa-file-word';
        else if (doc.format === 'text' || doc.format === 'markdown') icon = 'fa-file-alt';
        else if (doc.format === 'csv') icon = 'fa-file-csv';
        else if (doc.format === 'excel') icon = 'fa-file-excel';
        else if (doc.format === 'json') icon = 'fa-file-code';
        
        const date = new Date(doc.uploadDate);
        const formattedDate = formatDate(date);
        
        li.innerHTML = `
            <div class="document-icon">
                <i class="fas ${icon}" aria-hidden="true"></i>
            </div>
            <div class="document-item-info">
                <div class="document-name">${escapeHTML(doc.originalName)}</div>
                <div class="document-date">${formattedDate}</div>
            </div>
            <button class="document-actions-btn" aria-label="Opciones de documento">
                <i class="fas fa-ellipsis-v" aria-hidden="true"></i>
            </button>
        `;
        
        // Evento para mostrar vista previa
        li.addEventListener('click', (e) => {
            if (!e.target.classList.contains('document-actions-btn') && 
                !e.target.classList.contains('fa-ellipsis-v')) {
                showDocumentPreview(doc.id);
            }
        });
        
        // Añadir navegación por teclado
        li.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                showDocumentPreview(doc.id);
            }
        });
        
        // Menú contextual para acciones de documento
        const actionsBtn = li.querySelector('.document-actions-btn');
        actionsBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            
            // Crear menú contextual
            const menu = document.createElement('div');
            menu.className = 'context-menu';
            menu.setAttribute('role', 'menu');
            menu.innerHTML = `
                <ul>
                    <li data-action="preview" role="menuitem" tabindex="0">Ver documento</li>
                    <li data-action="search" role="menuitem" tabindex="0">Buscar en este documento</li>
                    <li data-action="delete" class="danger" role="menuitem" tabindex="0">Eliminar documento</li>
                </ul>
            `;
            
            // Posicionar menú
            menu.style.position = 'absolute';
            menu.style.top = `${e.clientY}px`;
            menu.style.left = `${e.clientX}px`;
            
            // Añadir al DOM
            document.body.appendChild(menu);
            
            // Enfocar primer elemento
            setTimeout(() => {
                menu.querySelector('li').focus();
            }, 10);
            
            // Eventos de menú
            menu.addEventListener('click', (menuEvent) => {
                const action = menuEvent.target.dataset.action;
                
                if (action === 'preview') {
                    showDocumentPreview(doc.id);
                } else if (action === 'search') {
                    showDocumentSearch(doc.id);
                } else if (action === 'delete') {
                    confirmDeleteDocument(doc.id, doc.originalName);
                }
                
                menu.remove();
            });
            
            // Navegación por teclado en el menú
            menu.addEventListener('keydown', (keyEvent) => {
                const items = Array.from(menu.querySelectorAll('li'));
                const currentIndex = items.indexOf(document.activeElement);
                
                if (keyEvent.key === 'ArrowDown' || keyEvent.key === 'ArrowUp') {
                    keyEvent.preventDefault();
                    
                    let nextIndex;
                    if (keyEvent.key === 'ArrowDown') {
                        nextIndex = (currentIndex < items.length - 1) ? currentIndex + 1 : 0;
                    } else {
                        nextIndex = (currentIndex <= 0) ? items.length - 1 : currentIndex - 1;
                    }
                    
                    items[nextIndex].focus();
                } else if (keyEvent.key === 'Enter' || keyEvent.key === ' ') {
                    keyEvent.preventDefault();
                    document.activeElement.click();
                } else if (keyEvent.key === 'Escape') {
                    keyEvent.preventDefault();
                    menu.remove();
                }
            });
            
            // Cerrar menú al hacer clic fuera
            document.addEventListener('click', function closeMenu(event) {
                if (!menu.contains(event.target) && event.target !== actionsBtn) {
                    menu.remove();
                    document.removeEventListener('click', closeMenu);
                }
            });
        });
        
        documentList.appendChild(li);
    });
}

/**
 * Muestra la vista previa de un documento
 * @async
 * @param {string} docId - ID del documento
 */
async function showDocumentPreview(docId) {
    if (!currentConversationId) return;
    
    try {
        // Mostrar modal con indicador de carga
        const modal = document.getElementById('document-preview-modal');
        toggleModal('document-preview-modal', true);
        
        document.getElementById('document-content').innerHTML = `
            <div class="loading-message" role="status">
                <div class="loader"></div>
                <div>Cargando documento...</div>
            </div>
        `;
        
        // Cargar datos del documento
        const response = await fetchWithRetry(`/api/conversations/${currentConversationId}/documents/${docId}`);
        
        if (!response.ok) {
            throw new Error('Error al cargar documento');
        }
        
        const documentData = await response.json();
        
        // Actualizar título
        document.getElementById('document-preview-title').textContent = documentData.originalName;
        
        // Mostrar metadatos
        const metadataDiv = document.getElementById('document-metadata');
        const uploadDate = new Date(documentData.uploadDate);
        metadataDiv.innerHTML = `
            <div><strong>Formato:</strong> ${documentData.format.toUpperCase()}</div>
            <div><strong>Tamaño:</strong> ${formatFileSize(documentData.size)}</div>
            <div><strong>Fecha de subida:</strong> ${formatDate(uploadDate, true)}</div>
        `;
        
        // Mostrar contenido
        const contentDiv = document.getElementById('document-content');
        
        // Limitar tamaño para documentos muy grandes
        let displayText = documentData.text;
        if (displayText.length > 100000) {
            displayText = displayText.substring(0, 100000) + '\n\n[Documento truncado por tamaño]';
        }
        
        // Formatear según tipo de documento
        if (documentData.format === 'markdown') {
            contentDiv.innerHTML = marked.parse(displayText);
        } else if (['csv', 'excel', 'json'].includes(documentData.format) && documentData.preview) {
            contentDiv.innerHTML = documentData.preview;
        } else {
            contentDiv.innerText = displayText;
        }
        
        // Mostrar análisis
        document.getElementById('document-summary').innerText = documentData.summary || 'No hay resumen disponible';
        
        // Mostrar conceptos clave
        const conceptsDiv = document.getElementById('document-concepts');
        if (documentData.keyConcepts && documentData.keyConcepts.length > 0) {
            conceptsDiv.innerHTML = '';
            documentData.keyConcepts.forEach(concept => {
                const conceptTag = document.createElement('div');
                conceptTag.className = 'concept-tag';
                
                // Si el concepto es un objeto con word y count, o solo un string
                const conceptText = concept.word || concept;
                const conceptScore = concept.importance || concept.count;
                
                conceptTag.innerHTML = `
                    ${escapeHTML(conceptText)}
                    ${conceptScore ? `<span class="concept-score">${conceptScore.toFixed(2)}</span>` : ''}
                `;
                conceptsDiv.appendChild(conceptTag);
            });
        } else {
            conceptsDiv.innerHTML = '<p class="empty-message">No se detectaron conceptos clave</p>';
        }
        
        // Mostrar entidades
        const entitiesDiv = document.getElementById('document-entities');
        if (documentData.entities && documentData.entities.length > 0) {
            entitiesDiv.innerHTML = '';
            documentData.entities.forEach(entity => {
                const entityItem = document.createElement('div');
                entityItem.className = 'entity-item';
                entityItem.textContent = `${entity.name} (${entity.type})`;
                entitiesDiv.appendChild(entityItem);
            });
        } else {
            entitiesDiv.innerHTML = '<p class="empty-message">No se detectaron entidades</p>';
        }
        
        // Configurar botones
        const deleteBtn = document.getElementById('document-delete-btn');
        deleteBtn.onclick = () => {
            // Cerrar modal y confirmar eliminación
            toggleModal('document-preview-modal', false);
            confirmDeleteDocument(docId, documentData.originalName);
        };
        
        const searchBtn = document.getElementById('document-search-btn');
        searchBtn.onclick = () => {
            // Cerrar modal actual y abrir modal de búsqueda
            toggleModal('document-preview-modal', false);
            showDocumentSearch(docId);
        };
    } catch (error) {
        console.error('Error:', error);
        document.getElementById('document-content').innerHTML = 'Error al cargar el documento';
    }
}

/**
 * Confirma la eliminación de un documento
 * @param {string} docId - ID del documento
 * @param {string} docName - Nombre del documento
 */
function confirmDeleteDocument(docId, docName) {
    // Usar modal de confirmación en lugar de confirm
    const confirmModal = document.createElement('div');
    confirmModal.className = 'modal confirmation-modal';
    confirmModal.id = 'delete-document-confirmation-modal';
    confirmModal.setAttribute('role', 'dialog');
    confirmModal.setAttribute('aria-labelledby', 'delete-document-confirm-title');
    
    confirmModal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h3 id="delete-document-confirm-title">Confirmar eliminación</h3>
                <button class="close-modal-btn" aria-label="Cerrar">&times;</button>
            </div>
            <div class="modal-body">
                <p>¿Estás seguro de que deseas eliminar el documento "${escapeHTML(docName)}"? Esta acción no se puede deshacer.</p>
            </div>
            <div class="modal-footer">
                <button id="cancel-delete-doc-btn" class="secondary-btn">Cancelar</button>
                <button id="confirm-delete-doc-btn" class="danger-btn">Eliminar</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(confirmModal);
    
    // Mostrar modal
    setTimeout(() => {
        confirmModal.classList.add('active');
        document.getElementById('confirm-delete-doc-btn').focus();
    }, 10);
    
    // Eventos
    document.getElementById('confirm-delete-doc-btn').addEventListener('click', () => {
        confirmModal.classList.remove('active');
        setTimeout(() => {
            confirmModal.remove();
            deleteDocument(docId);
        }, 300);
    });
    
    const cancelAction = () => {
        confirmModal.classList.remove('active');
        setTimeout(() => confirmModal.remove(), 300);
    };
    
    document.getElementById('cancel-delete-doc-btn').addEventListener('click', cancelAction);
    confirmModal.querySelector('.close-modal-btn').addEventListener('click', cancelAction);
}

/**
 * Elimina un documento
 * @async
 * @param {string} docId - ID del documento a eliminar
 */
async function deleteDocument(docId) {
    if (!currentConversationId) return;
    
    try {
        const response = await fetchWithRetry(`/api/conversations/${currentConversationId}/documents/${docId}`, {
            method: 'DELETE',
            headers: {
                'X-CSRF-Token': csrfToken
            }
        });
        
        if (!response.ok) {
            throw new Error(ERROR_MESSAGES.DELETE_DOCUMENT);
        }
        
        // Actualizar lista de documentos
        loadConversationDocuments(currentConversationId);
        
        // Cerrar modal si está abierto
        toggleModal('document-preview-modal', false);
        
        showToast(TOAST_TYPES.SUCCESS, 'Documento eliminado', SUCCESS_MESSAGES.DOCUMENT_DELETED);
    } catch (error) {
        console.error('Error:', error);
        showToast(TOAST_TYPES.ERROR, 'Error', ERROR_MESSAGES.DELETE_DOCUMENT);
    }
}

/**
 * Muestra el modal de búsqueda en documentos
 * @param {string} [docId] - ID del documento para búsqueda específica (opcional)
 */
function showDocumentSearch(docId) {
    if (!currentConversationId) return;
    
    // Mostrar modal
    toggleModal('document-search-modal', true);
    
    // Limpiar resultados anteriores
    document.getElementById('document-search-results').innerHTML = '';
    document.getElementById('document-search-input').value = '';
    
    // Si se proporcionó un documento específico, marcarlo en la interfaz
    if (docId) {
        const specificDocInput = document.getElementById('specific-document-input');
        if (specificDocInput) {
            specificDocInput.value = docId;
        } else {
            // Crear input oculto si no existe
            const hiddenInput = document.createElement('input');
            hiddenInput.type = 'hidden';
            hiddenInput.id = 'specific-document-input';
            hiddenInput.value = docId;
            document.getElementById('document-search-modal').appendChild(hiddenInput);
            
            // Añadir indicador visual
            const searchHeader = document.querySelector('#document-search-modal .modal-header h3');
            if (searchHeader) {
                searchHeader.innerHTML = 'Buscar en documento específico <span class="badge">1 documento</span>';
            }
        }
    } else {
        // Quitar input si existe
        const specificDocInput = document.getElementById('specific-document-input');
        if (specificDocInput) {
            specificDocInput.remove();
        }
        
        // Restaurar título
        const searchHeader = document.querySelector('#document-search-modal .modal-header h3');
        if (searchHeader) {
            searchHeader.textContent = 'Buscar en documentos';
        }
    }
    
    // Enfocar el input
    setTimeout(() => {
        document.getElementById('document-search-input').focus();
    }, 100);
}

/**
 * Realiza búsqueda en los documentos
 * @async
 */
async function searchInDocuments() {
    if (!currentConversationId) return;
    
    const searchTerm = document.getElementById('document-search-input').value.trim();
    
    if (searchTerm.length < 3) {
        showToast(TOAST_TYPES.WARNING, 'Término demasiado corto', 'Ingresa al menos 3 caracteres para buscar');
        return;
    }
    
    try {
        // Mostrar indicador de carga
        document.getElementById('document-search-results').innerHTML = `
            <div class="loading-message" role="status">
                <div class="loader"></div>
                <div>Buscando...</div>
            </div>
        `;
        
        // Comprobar si hay un documento específico
        const specificDocInput = document.getElementById('specific-document-input');
        let url = `/api/conversations/${currentConversationId}/documents/search/${encodeURIComponent(searchTerm)}`;
        
        if (specificDocInput && specificDocInput.value) {
            url += `?docId=${specificDocInput.value}`;
        }
        
        const response = await fetchWithRetry(url);
        
        if (!response.ok) {
            throw new Error(ERROR_MESSAGES.SEARCH);
        }
        
        const results = await response.json();
        displaySearchResults(results, searchTerm);
    } catch (error) {
        console.error('Error:', error);
        document.getElementById('document-search-results').innerHTML = 'Error al realizar la búsqueda';
    }
}

/**
 * Muestra los resultados de búsqueda
 * @param {Array} results - Resultados de búsqueda
 * @param {string} searchTerm - Término de búsqueda
 */
function displaySearchResults(results, searchTerm) {
    const resultsContainer = document.getElementById('document-search-results');
    resultsContainer.setAttribute('role', 'region');
    resultsContainer.setAttribute('aria-live', 'polite');
    
    if (!results || results.length === 0) {
        resultsContainer.innerHTML = '<div class="empty-message" role="status">No se encontraron resultados para la búsqueda</div>';
        return;
    }
    
    resultsContainer.innerHTML = `<div class="search-summary" role="status">Se encontraron ${results.length} resultados</div>`;
    
    results.forEach(result => {
        const resultDiv = document.createElement('div');
        resultDiv.className = 'search-result-item';
        resultDiv.setAttribute('tabindex', '0');
        resultDiv.setAttribute('role', 'listitem');
        
        // Determinar icono según formato
        let icon = 'fa-file';
        if (result.format === 'pdf') icon = 'fa-file-pdf';
        else if (result.format === 'docx') icon = 'fa-file-word';
        else if (result.format === 'text' || result.format === 'markdown') icon = 'fa-file-alt';
        else if (result.format === 'csv') icon = 'fa-file-csv';
        else if (result.format === 'excel') icon = 'fa-file-excel';
        else if (result.format === 'json') icon = 'fa-file-code';
        
        // Formatear y resaltar fragmentos
        const snippets = result.contexts.map(context => {
            return escapeHTML(context).replace(
                new RegExp(escapeRegExp(searchTerm), 'gi'),
                match => `<mark class="result-highlight">${match}</mark>`
            );
        }).join('<br><br>');
        
        resultDiv.innerHTML = `
            <div class="result-title">
                <i class="fas ${icon}" aria-hidden="true"></i> ${escapeHTML(result.fileName)}
            </div>
            <div class="result-snippet">${snippets}</div>
            <div class="result-meta">
                <span>Subido el ${formatDate(new Date(result.uploadDate))}</span>
            </div>
        `;
        
        // Evento para abrir el documento
        resultDiv.addEventListener('click', () => {
            toggleModal('document-search-modal', false);
            showDocumentPreview(result.docId);
        });
        
        // Navegación por teclado
        resultDiv.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                toggleModal('document-search-modal', false);
                showDocumentPreview(result.docId);
            }
        });
        
        resultsContainer.appendChild(resultDiv);
    });
}

/**
 * Implementa búsqueda global en todas las conversaciones
 * @async
 */
async function searchGlobal() {
    const searchInput = document.getElementById('global-search-input');
    if (!searchInput) return;
    
    const searchTerm = searchInput.value.trim();
    
    if (searchTerm.length < 3) {
        showToast(TOAST_TYPES.WARNING, 'Término demasiado corto', 'Ingresa al menos 3 caracteres para buscar');
        return;
    }
    
    try {
        // Mostrar indicador de carga
        const resultsContainer = document.getElementById('global-search-results');
        resultsContainer.innerHTML = `
            <div class="loading-message" role="status">
                <div class="loader"></div>
                <div>Buscando...</div>
            </div>
        `;
        
        const response = await fetchWithRetry(`/api/search/global/${encodeURIComponent(searchTerm)}`);
        
        if (!response.ok) {
            throw new Error('Error al realizar la búsqueda global');
        }
        
        const results = await response.json();
        displayGlobalSearchResults(results, searchTerm);
    } catch (error) {
        console.error('Error:', error);
        const resultsContainer = document.getElementById('global-search-results');
        resultsContainer.innerHTML = '<div class="empty-message">Error al realizar la búsqueda</div>';
    }
}

/**
 * Muestra resultados de búsqueda global
 * @param {Object} results - Resultados de búsqueda
 * @param {string} searchTerm - Término buscado
 */
function displayGlobalSearchResults(results, searchTerm) {
    const resultsContainer = document.getElementById('global-search-results');
    resultsContainer.innerHTML = '';
    
    if (!results.conversations || results.conversations.length === 0) {
        resultsContainer.innerHTML = '<div class="empty-message" role="status">No se encontraron resultados</div>';
        return;
    }
    
    // Mostrar resumen
    const totalResults = results.conversations.reduce((sum, conv) => sum + conv.matches.length, 0);
    resultsContainer.innerHTML = `<div class="search-summary" role="status">Se encontraron ${totalResults} resultados en ${results.conversations.length} conversaciones</div>`;
    
    // Agrupar por conversación
    results.conversations.forEach(conversation => {
        const conversationDiv = document.createElement('div');
        conversationDiv.className = 'search-conversation';
        
        // Encabezado de conversación
        const headerDiv = document.createElement('div');
        headerDiv.className = 'search-conversation-header';
        headerDiv.innerHTML = `
            <div class="search-conversation-title">
                <i class="fas fa-comments" aria-hidden="true"></i>
                ${escapeHTML(conversation.title)}
            </div>
            <div class="search-conversation-info">
                ${conversation.matches.length} resultados · ${formatDate(new Date(conversation.lastActive))}
            </div>
        `;
        
        // Hacer clic en el encabezado abre la conversación
        headerDiv.addEventListener('click', () => {
            toggleModal('global-search-modal', false);
            loadConversation(conversation.id);
        });
        
        conversationDiv.appendChild(headerDiv);
        
        // Resultados dentro de la conversación
        const matchesContainer = document.createElement('div');
        matchesContainer.className = 'search-matches';
        
        conversation.matches.forEach(match => {
            const matchDiv = document.createElement('div');
            matchDiv.className = 'search-match';
            
            // Resaltar término de búsqueda
            const highlightedText = escapeHTML(match.content).replace(
                new RegExp(escapeRegExp(searchTerm), 'gi'),
                match => `<mark class="result-highlight">${match}</mark>`
            );
            
            // Fecha del mensaje
            const messageDate = new Date(match.timestamp);
            const timeStr = messageDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            
            matchDiv.innerHTML = `
                <div class="search-match-sender">${match.role === 'user' ? 'Tú' : 'Asistente'} - ${timeStr}</div>
                <div class="search-match-content">${highlightedText}</div>
            `;
            
            matchesContainer.appendChild(matchDiv);
        });
        
        conversationDiv.appendChild(matchesContainer);
        resultsContainer.appendChild(conversationDiv);
    });
}

// ===== CONTEXTO Y MEMORIA =====

/**
 * Carga información de contexto y memoria
 * @async
 * @param {string} conversationId - ID de la conversación
 */
async function loadContextInfo(conversationId) {
    try {
        // Cargar contexto
        await loadContextData(conversationId);
        
        // Cargar memoria
        await loadMemoryData(conversationId);
    } catch (error) {
        console.error('Error al cargar información de contexto:', error);
    }
}

/**
 * Carga datos de contexto
 * @async
 * @param {string} conversationId - ID de la conversación
 */
async function loadContextData(conversationId) {
    try {
        const response = await fetchWithRetry(`/api/conversations/${conversationId}/context`);
        
        if (response.ok) {
            const contextData = await response.json();
            displayContextData(contextData);
        }
    } catch (error) {
        console.error('Error al cargar datos de contexto:', error);
        document.getElementById('entity-list').innerHTML = '<p class="empty-message" role="status">Error al cargar entidades</p>';
        document.getElementById('topic-list').innerHTML = '<p class="empty-message" role="status">Error al cargar temas</p>';
    }
}

/**
 * Muestra datos de contexto
 * @param {Object} contextData - Datos de contexto
 */
function displayContextData(contextData) {
    // Mostrar entidades
    const entityList = document.getElementById('entity-list');
    entityList.setAttribute('role', 'list');
    
    if (contextData.entities && contextData.entities.length > 0) {
        entityList.innerHTML = '';
        contextData.entities.forEach(entity => {
            const entityDiv = document.createElement('div');
            entityDiv.className = 'entity-item';
            entityDiv.setAttribute('role', 'listitem');
            entityDiv.textContent = entity.name;
            entityDiv.title = entity.type + (entity.description ? ': ' + entity.description : '');
            entityList.appendChild(entityDiv);
        });
    } else {
        entityList.innerHTML = '<p class="empty-message" role="status">No hay entidades detectadas</p>';
    }
    
    // Mostrar temas
    const topicList = document.getElementById('topic-list');
    topicList.setAttribute('role', 'list');
    
    if (contextData.topics && contextData.topics.length > 0) {
        topicList.innerHTML = '';
        contextData.topics.forEach(topic => {
            const topicDiv = document.createElement('div');
            topicDiv.className = 'topic-item';
            topicDiv.setAttribute('role', 'listitem');
            topicDiv.textContent = topic.name;
            topicList.appendChild(topicDiv);
        });
    } else {
        topicList.innerHTML = '<p class="empty-message" role="status">No hay temas identificados</p>';
    }
}

/**
 * Carga datos de memoria
 * @async
 * @param {string} conversationId - ID de la conversación
 */
async function loadMemoryData(conversationId) {
    try {
        const response = await fetchWithRetry(`/api/conversations/${conversationId}/memory`);
        
        if (response.ok) {
            const memoryData = await response.json();
            displayMemoryData(memoryData);
        }
    } catch (error) {
        console.error('Error al cargar datos de memoria:', error);
        document.getElementById('short-term-memory').innerHTML = '<p class="empty-message" role="status">Error al cargar memoria</p>';
        document.getElementById('long-term-memory').innerHTML = '<p class="empty-message" role="status">Error al cargar memoria</p>';
    }
}

/**
 * Muestra datos de memoria
 * @param {Object} memoryData - Datos de memoria
 */
function displayMemoryData(memoryData) {
    // Memoria a corto plazo
    const shortTermDiv = document.getElementById('short-term-memory');
    shortTermDiv.setAttribute('role', 'list');
    
    if (memoryData.shortTerm && memoryData.shortTerm.length > 0) {
        shortTermDiv.innerHTML = '';
        
        // Mostrar solo los 5 items más recientes
        const recentItems = memoryData.shortTerm.slice(0, 5);
        
        recentItems.forEach(item => {
            const memoryItem = document.createElement('div');
            memoryItem.className = 'memory-item';
            memoryItem.setAttribute('role', 'listitem');
            
            // Extracto del mensaje
            const messagePreview = item.userMessage 
                ? (item.userMessage.length > 60 ? item.userMessage.substring(0, 60) + '...' : item.userMessage)
                : 'Mensaje no disponible';
            
            // Información de relevancia
            const relevanceInfo = item.relevance 
                ? `Relevancia: ${(item.relevance * 100).toFixed(0)}%` 
                : '';
            
            memoryItem.innerHTML = `
                <div class="memory-content">${escapeHTML(messagePreview)}</div>
                <div class="memory-meta">
                    ${relevanceInfo}
                    ${item.timestamp ? ' • ' + formatDate(new Date(item.timestamp)) : ''}
                </div>
            `;
            
            shortTermDiv.appendChild(memoryItem);
        });
        
        // Indicar si hay más items
        if (memoryData.shortTerm.length > 5) {
            const moreInfo = document.createElement('div');
            moreInfo.className = 'memory-more';
            moreInfo.textContent = `Y ${memoryData.shortTerm.length - 5} items más`;
            shortTermDiv.appendChild(moreInfo);
        }
    } else {
        shortTermDiv.innerHTML = '<p class="empty-message" role="status">No hay datos en memoria a corto plazo</p>';
    }
    
    // Memoria a largo plazo
    const longTermDiv = document.getElementById('long-term-memory');
    longTermDiv.setAttribute('role', 'list');
    
    if (memoryData.longTerm && memoryData.longTerm.length > 0) {
        longTermDiv.innerHTML = '';
        
        // Mostrar solo los 5 items más relevantes
        const relevantItems = [...memoryData.longTerm]
            .sort((a, b) => (b.relevance || 0) - (a.relevance || 0))
            .slice(0, 5);
        
        relevantItems.forEach(item => {
            const memoryItem = document.createElement('div');
            memoryItem.className = 'memory-item';
            memoryItem.setAttribute('role', 'listitem');
            
            // Extracto del mensaje o entidad
            let content = 'Item de memoria';
            if (item.userMessage) {
                content = item.userMessage.length > 60 
                    ? item.userMessage.substring(0, 60) + '...' 
                    : item.userMessage;
            } else if (item.entities && item.entities.length > 0) {
                content = 'Entidades: ' + item.entities.map(e => e.name).join(', ');
            }
            
            // Información de relevancia
            const relevanceInfo = item.relevance 
                ? `Relevancia: ${(item.relevance * 100).toFixed(0)}%` 
                : '';
            
            memoryItem.innerHTML = `
                <div class="memory-content">${escapeHTML(content)}</div>
                <div class="memory-meta">
                    ${relevanceInfo}
                    ${item.timestamp ? ' • ' + formatDate(new Date(item.timestamp)) : ''}
                </div>
            `;
            
            longTermDiv.appendChild(memoryItem);
        });
        
        // Indicar si hay más items
        if (memoryData.longTerm.length > 5) {
            const moreInfo = document.createElement('div');
            moreInfo.className = 'memory-more';
            moreInfo.textContent = `Y ${memoryData.longTerm.length - 5} items más`;
            longTermDiv.appendChild(moreInfo);
        }
    } else {
        longTermDiv.innerHTML = '<p class="empty-message" role="status">No hay datos en memoria a largo plazo</p>';
    }
}

/**
 * Confirma el reinicio de memoria
 */
function confirmResetMemory() {
    // Usar modal de confirmación
    const confirmModal = document.createElement('div');
    confirmModal.className = 'modal confirmation-modal';
    confirmModal.id = 'reset-memory-confirmation-modal';
    confirmModal.setAttribute('role', 'dialog');
    confirmModal.setAttribute('aria-labelledby', 'reset-memory-confirm-title');
    
    confirmModal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h3 id="reset-memory-confirm-title">Confirmar reinicio de memoria</h3>
                <button class="close-modal-btn" aria-label="Cerrar">&times;</button>
            </div>
            <div class="modal-body">
                <p>¿Estás seguro de que deseas reiniciar toda la memoria? Esta acción eliminará toda la memoria a corto y largo plazo, y no se puede deshacer.</p>
            </div>
            <div class="modal-footer">
                <button id="cancel-reset-memory-btn" class="secondary-btn">Cancelar</button>
                <button id="confirm-reset-memory-btn" class="danger-btn">Reiniciar</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(confirmModal);
    
    // Mostrar modal
    setTimeout(() => {
        confirmModal.classList.add('active');
        document.getElementById('confirm-reset-memory-btn').focus();
    }, 10);
    
    // Eventos
    document.getElementById('confirm-reset-memory-btn').addEventListener('click', () => {
        confirmModal.classList.remove('active');
        setTimeout(() => {
            confirmModal.remove();
            resetMemory();
        }, 300);
    });
    
    const cancelAction = () => {
        confirmModal.classList.remove('active');
        setTimeout(() => confirmModal.remove(), 300);
    };
    
    document.getElementById('cancel-reset-memory-btn').addEventListener('click', cancelAction);
    confirmModal.querySelector('.close-modal-btn').addEventListener('click', cancelAction);
}

/**
 * Reinicia la memoria
 * @async
 */
async function resetMemory() {
    try {
        const response = await fetchWithRetry('/api/memory/reset', {
            method: 'POST',
            headers: {
                'X-CSRF-Token': csrfToken
            }
        });
        
        if (!response.ok) {
            throw new Error(ERROR_MESSAGES.RESET_MEMORY);
        }
        
        // Recargar información de memoria
        if (currentConversationId) {
            await loadMemoryData(currentConversationId);
        }
        
        showToast(TOAST_TYPES.SUCCESS, 'Memoria reiniciada', SUCCESS_MESSAGES.MEMORY_RESET);
    } catch (error) {
        console.error('Error:', error);
        showToast(TOAST_TYPES.ERROR, 'Error', ERROR_MESSAGES.RESET_MEMORY);
    }
}

// ===== CONFIGURACIÓN =====

/**
 * Carga la configuración guardada
 */
function loadSettings() {
    // Intentar cargar desde localStorage
    const savedSettings = localStorage.getItem('cagSettings');
    
    if (savedSettings) {
        try {
            const parsedSettings = JSON.parse(savedSettings);
            currentSettings = { ...currentSettings, ...parsedSettings };
        } catch (error) {
            console.error('Error al parsear configuración guardada:', error);
        }
    }
    
    // Aplicar configuración a la interfaz
    document.getElementById('temperature-setting').value = currentSettings.temperature;
    document.getElementById('temperature-value').textContent = currentSettings.temperature;
    
    document.getElementById('max-tokens-setting').value = currentSettings.max_tokens;
    document.getElementById('max-tokens-value').textContent = currentSettings.max_tokens;
    
    document.getElementById('system-prompt-setting').value = currentSettings.system_prompt || '';
    
    document.getElementById('dark-mode-setting').checked = currentSettings.darkMode;
    document.getElementById('auto-scroll-setting').checked = currentSettings.autoScroll;
    document.getElementById('memory-enabled-setting').checked = currentSettings.memoryEnabled;
    document.getElementById('global-memory-setting').checked = currentSettings.globalMemoryEnabled;
    
    document.getElementById('model-selection').value = currentSettings.model;
    
    // Aplicar modo oscuro si está activado
    if (currentSettings.darkMode) {
        enableDarkMode();
    }
}

/**
 * Guarda la configuración actual
 * @async
 */
async function saveSettings() {
    // Obtener valores de la interfaz
    currentSettings.temperature = parseFloat(document.getElementById('temperature-setting').value);
    currentSettings.max_tokens = parseInt(document.getElementById('max-tokens-setting').value);
    currentSettings.system_prompt = document.getElementById('system-prompt-setting').value || null;
    currentSettings.darkMode = document.getElementById('dark-mode-setting').checked;
    currentSettings.autoScroll = document.getElementById('auto-scroll-setting').checked;
    currentSettings.memoryEnabled = document.getElementById('memory-enabled-setting').checked;
    currentSettings.globalMemoryEnabled = document.getElementById('global-memory-setting').checked;
    currentSettings.model = document.getElementById('model-selection').value;
    
    // Guardar en localStorage
    localStorage.setItem('cagSettings', JSON.stringify(currentSettings));
    
    // Guardar config en el servidor
    try {
        await fetchWithRetry('/api/config', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': csrfToken
            },
            body: JSON.stringify({
                temperature: currentSettings.temperature,
                max_tokens: currentSettings.max_tokens,
                system_prompt: currentSettings.system_prompt,
                model: currentSettings.model
            })
        });
    } catch (error) {
        console.error('Error al guardar configuración en servidor:', error);
    }
    
    // Cerrar modal
    toggleModal('settings-modal', false);
    
    showToast(TOAST_TYPES.SUCCESS, 'Configuración guardada', SUCCESS_MESSAGES.SETTINGS_SAVED);
}

/**
 * Restablece la configuración por defecto
 */
function resetSettings() {
    currentSettings = { ...DEFAULT_SETTINGS };
    
    // Actualizar interfaz
    document.getElementById('temperature-setting').value = currentSettings.temperature;
    document.getElementById('temperature-value').textContent = currentSettings.temperature;
    
    document.getElementById('max-tokens-setting').value = currentSettings.max_tokens;
    document.getElementById('max-tokens-value').textContent = currentSettings.max_tokens;
    
    document.getElementById('system-prompt-setting').value = '';
    
    document.getElementById('dark-mode-setting').checked = currentSettings.darkMode;
    document.getElementById('auto-scroll-setting').checked = currentSettings.autoScroll;
    document.getElementById('memory-enabled-setting').checked = currentSettings.memoryEnabled;
    document.getElementById('global-memory-setting').checked = currentSettings.globalMemoryEnabled;
    
    document.getElementById('model-selection').value = currentSettings.model;
    
    // Desactivar modo oscuro
    disableDarkMode();
    
    showToast(TOAST_TYPES.INFO, 'Configuración restablecida', SUCCESS_MESSAGES.SETTINGS_RESET);
}

// ===== UTILIDADES =====

/**
 * Comprueba el estado del sistema
 * @async
 */
async function checkSystemStatus() {
    try {
        const response = await fetchWithTimeout('/api/system/status');
        
        if (response.ok) {
            const data = await response.json();
            
            // Actualizar indicador de estado
            const statusDot = document.querySelector('.status-dot');
            const statusText = document.querySelector('.status-text');
            
            statusDot.className = 'status-dot online';
            statusText.textContent = 'Sistema activo';
        } else {
            updateSystemStatusError();
        }
    } catch (error) {
        console.error('Error al comprobar estado del sistema:', error);
        updateSystemStatusError();
    }
}

/**
 * Actualiza el indicador de estado a error
 */
function updateSystemStatusError() {
    const statusDot = document.querySelector('.status-dot');
    const statusText = document.querySelector('.status-text');
    
    statusDot.className = 'status-dot error';
    statusText.textContent = 'Error de conexión';
}

/**
 * Formatea una fecha de forma amigable
 * @param {Date} date - Fecha a formatear
 * @param {boolean} includeTime - Si debe incluir la hora
 * @param {string} locale - Código de localización (por defecto: navegador)
 * @param {string} timeZone - Zona horaria (por defecto: local)
 * @returns {string} - Fecha formateada
 */
function formatDate(date, includeTime = false, locale = undefined, timeZone = undefined) {
    if (!date) return '';
    
    // Opciones para Intl.DateTimeFormat
    const dateOptions = {
        timeZone: timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone
    };
    
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    
    // Ajustar today a la zona horaria correcta
    const todayOffset = timeZone ? 
        new Date(today.toLocaleString('en-US', { timeZone })) : 
        today;
    
    const yesterday = new Date(todayOffset);
    yesterday.setDate(yesterday.getDate() - 1);
    
    // Ajustar date a la zona horaria correcta
    const dateInTZ = timeZone ? 
        new Date(date.toLocaleString('en-US', { timeZone })) : 
        date;
    
    const dateOnly = new Date(dateInTZ.getFullYear(), dateInTZ.getMonth(), dateInTZ.getDate());
    
    // Formatear tiempo
    const timeFormatter = new Intl.DateTimeFormat(locale, {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone
    });
    
    const timeStr = timeFormatter.format(date);
    
    if (dateOnly.getTime() === todayOffset.getTime()) {
        // Hoy
        return includeTime ? `Hoy a las ${timeStr}` : 'Hoy';
    } else if (dateOnly.getTime() === yesterday.getTime()) {
        // Ayer
        return includeTime ? `Ayer a las ${timeStr}` : 'Ayer';
    } else {
        // Otra fecha
        const dateFormatter = new Intl.DateTimeFormat(locale, {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            ...dateOptions
        });
        
        if (includeTime) {
            return `${dateFormatter.format(date)} ${timeStr}`;
        }
        
        return dateFormatter.format(date);
    }
}

/**
 * Formatea el tamaño de un archivo
 * @param {number} bytes - Tamaño en bytes
 * @returns {string} - Tamaño formateado
 */
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Escapa caracteres HTML para prevenir XSS
 * @param {string} text - Texto a escapar
 * @returns {string} - Texto escapado
 */
function escapeHTML(text) {
    if (!text) return '';
    
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Escapa caracteres especiales para uso en expresiones regulares
 * @param {string} string - Cadena a escapar
 * @returns {string} - Cadena escapada
 */
function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Muestra u oculta un modal
 * @param {string} modalId - ID del modal
 * @param {boolean} show - Si se debe mostrar
 */
function toggleModal(modalId, show) {
    const modal = document.getElementById(modalId);
    
    if (show) {
        modal.classList.add('active');
        document.body.style.overflow = 'hidden'; // Evitar scroll
        
        // Para accesibilidad, enfocar el primer elemento interactivo
        setTimeout(() => {
            const firstFocusable = modal.querySelector('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
            if (firstFocusable) {
                firstFocusable.focus();
            }
        }, 100);
        
        // Capturar Escape para cerrar
        document.addEventListener('keydown', function escKeyHandler(e) {
            if (e.key === 'Escape') {
                toggleModal(modalId, false);
                document.removeEventListener('keydown', escKeyHandler);
            }
        });
    } else {
        modal.classList.remove('active');
        document.body.style.overflow = ''; // Restaurar scroll
    }
}

/**
 * Muestra notificación toast
 * @param {string} type - Tipo de notificación
 * @param {string} title - Título
 * @param {string} message - Mensaje
 * @param {number} duration - Duración en ms (0 para no auto-cerrar)
 * @returns {HTMLElement} - Elemento toast creado
 */
function showToast(type, title, message, duration = 5000) {
    const toastContainer = document.getElementById('toast-container') || createToastContainer();
    
    // Crear toast
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.setAttribute('role', 'alert');
    toast.setAttribute('aria-live', 'assertive');
    
    // Determinar icono según tipo
    let icon = 'info-circle';
    if (type === TOAST_TYPES.SUCCESS) icon = 'check-circle';
    else if (type === TOAST_TYPES.ERROR) icon = 'exclamation-circle';
    else if (type === TOAST_TYPES.WARNING) icon = 'exclamation-triangle';
    
    toast.innerHTML = `
        <div class="toast-icon">
            <i class="fas fa-${icon}" aria-hidden="true"></i>
        </div>
        <div class="toast-content">
            <div class="toast-title">${escapeHTML(title)}</div>
            <div class="toast-message">${escapeHTML(message)}</div>
        </div>
        <button class="toast-close" aria-label="Cerrar notificación">&times;</button>
    `;
    
    // Añadir al contenedor
    toastContainer.appendChild(toast);
    
    // Botón de cerrar
    toast.querySelector('.toast-close').addEventListener('click', () => {
        toast.classList.add('closing');
        setTimeout(() => {
            if (toast.parentNode) {
                toast.remove();
            }
        }, 300);
    });
    
    // Auto-cerrar después de duración (si no es 0)
    if (duration > 0) {
        setTimeout(() => {
            if (toast.parentNode) {
                toast.classList.add('closing');
                setTimeout(() => {
                    if (toast.parentNode) {
                        toast.remove();
                    }
                }, 300);
            }
        }, duration);
    }
    
    return toast;
}

/**
 * Crea el contenedor de toasts si no existe
 * @returns {HTMLElement} - Contenedor de toasts
 */
function createToastContainer() {
    let container = document.getElementById('toast-container');
    
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        document.body.appendChild(container);
    }
    
    return container;
}

/**
 * Oculta todos los toasts
 */
function hideAllToasts() {
    const toasts = document.querySelectorAll('.toast');
    toasts.forEach(toast => {
        toast.classList.add('closing');
        setTimeout(() => {
            if (toast.parentNode) {
                toast.remove();
            }
        }, 300);
    });
}

/**
 * Hace scroll al final de los mensajes
 */
function scrollToBottom() {
    const messageContainer = document.getElementById('message-container');
    messageContainer.scrollTop = messageContainer.scrollHeight;
}

/**
 * Muestra u oculta la barra lateral derecha en móvil
 */
function toggleRightSidebar() {
    const sidebar = document.querySelector('.right-sidebar');
    sidebar.classList.toggle('visible');
    
    const toggleBtn = document.getElementById('toggle-sidebar-btn');
    const isVisible = sidebar.classList.contains('visible');
    
    if (isVisible) {
        toggleBtn.innerHTML = '<i class="fas fa-chevron-right" aria-hidden="true"></i>';
        toggleBtn.setAttribute('aria-label', 'Ocultar panel lateral');
        toggleBtn.setAttribute('aria-expanded', 'true');
    } else {
        toggleBtn.innerHTML = '<i class="fas fa-chevron-left" aria-hidden="true"></i>';
        toggleBtn.setAttribute('aria-label', 'Mostrar panel lateral');
        toggleBtn.setAttribute('aria-expanded', 'false');
    }
}

/**
 * Función de debounce para limitar la frecuencia de eventos
 * @param {Function} func - Función a ejecutar
 * @param {number} wait - Tiempo de espera en ms
 * @returns {Function} - Función con debounce
 */
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

/**
 * Función fetch con timeout
 * @async
 * @param {string} url - URL para la petición
 * @param {Object} options - Opciones para fetch
 * @param {number} timeout - Timeout en ms
 * @returns {Promise} - Promesa con la respuesta
 */
async function fetchWithTimeout(url, options = {}, timeout = FETCH_TIMEOUT) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    
    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal
        });
        clearTimeout(id);
        return response;
    } catch (error) {
        clearTimeout(id);
        throw error;
    }
}

/**
 * Fetch con reintentos automáticos
 * @async
 * @param {string} url - URL para la petición
 * @param {Object} options - Opciones para fetch
 * @param {number} maxRetries - Número máximo de reintentos
 * @returns {Promise} - Promesa con la respuesta
 */
async function fetchWithRetry(url, options = {}, maxRetries = MAX_RETRY_ATTEMPTS) {
    let retries = 0;
    
    while (retries < maxRetries) {
        try {
            return await fetchWithTimeout(url, options);
        } catch (error) {
            retries++;
            
            // Si es el último intento o no es un error que pueda resolverse reintentando
            if (retries >= maxRetries || (error.name !== 'AbortError' && !isRetryableError(error))) {
                throw error;
            }
            
            console.log(`Reintentando petición (${retries}/${maxRetries}): ${url}`);
            
            // Esperar antes del siguiente intento (con backoff exponencial)
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * Math.pow(2, retries - 1)));
        }
    }
}

/**
 * Determina si un error permite reintentos
 * @param {Error} error - Error a analizar
 * @returns {boolean} - true si se puede reintentar
 */
function isRetryableError(error) {
    // Considerar errores de red o de servidor como retryables
    if (error.name === 'TypeError' || error.name === 'NetworkError') {
        return true;
    }
    
    // Considerar errores 429, 500, 502, 503, 504 como retryables
    if (error.status && [429, 500, 502, 503, 504].includes(error.status)) {
        return true;
    }
    
    return false;
}
