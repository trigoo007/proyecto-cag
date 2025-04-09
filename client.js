/**
 * Cliente para CAG Chat
 * 
 * Este archivo maneja toda la lógica del cliente para la aplicación CAG,
 * incluyendo la gestión de conversaciones, documentos, interfaz de usuario
 * y comunicación con el servidor.
 */

// ===== VARIABLES GLOBALES =====
let currentConversationId = null;
let currentSettings = {
    temperature: 0.7,
    max_tokens: 2048,
    system_prompt: null,
    darkMode: false,
    autoScroll: true,
    memoryEnabled: true,
    globalMemoryEnabled: true,
    model: 'gemma3:27b'
};
let isPendingResponse = false;
let documentUploadPending = false;

// ===== INICIALIZACIÓN =====
document.addEventListener('DOMContentLoaded', async () => {
    // Cargar configuración
    loadSettings();
    
    // Inicializar eventos para elementos UI
    initUIEvents();
    
    // Inicializar markdown y highlight.js
    initRenderers();
    
    // Comprobar estado del sistema
    checkSystemStatus();
    
    // Cargar lista de conversaciones
    await loadConversations();
    
    // Inicializar pestañas
    initTabs();
    
    // Inicializar detección de tema oscuro
    detectDarkMode();
});

// ===== INICIALIZACIÓN DE UI =====
function initUIEvents() {
    // Botón de nueva conversación
    document.getElementById('new-chat-btn').addEventListener('click', createNewConversation);
    
    // Input de mensaje
    const messageInput = document.getElementById('message-input');
    messageInput.addEventListener('input', handleMessageInput);
    messageInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });
    
    // Botón de enviar
    document.getElementById('send-btn').addEventListener('click', sendMessage);
    
    // Botón de configuración
    document.getElementById('settings-btn').addEventListener('click', () => toggleModal('settings-modal', true));
    document.querySelectorAll('.close-modal-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const modal = e.target.closest('.modal');
            toggleModal(modal.id, false);
        });
    });
    
    // Cambiar título de conversación
    document.getElementById('edit-title-btn').addEventListener('click', editConversationTitle);
    
    // Botón de subir documento
    document.getElementById('upload-document-btn').addEventListener('click', () => {
        document.getElementById('document-upload-input').click();
    });
    document.getElementById('upload-document-sidebar-btn').addEventListener('click', () => {
        document.getElementById('document-upload-input').click();
    });
    document.getElementById('document-upload-input').addEventListener('change', handleDocumentUpload);
    
    // Botones de configuración
    document.getElementById('save-settings-btn').addEventListener('click', saveSettings);
    document.getElementById('reset-settings-btn').addEventListener('click', resetSettings);
    
    // Slider de temperatura
    const temperatureSlider = document.getElementById('temperature-setting');
    const temperatureValue = document.getElementById('temperature-value');
    temperatureSlider.addEventListener('input', () => {
        temperatureValue.textContent = temperatureSlider.value;
    });
    
    // Slider de max_tokens
    const maxTokensSlider = document.getElementById('max-tokens-setting');
    const maxTokensValue = document.getElementById('max-tokens-value');
    maxTokensSlider.addEventListener('input', () => {
        maxTokensValue.textContent = maxTokensSlider.value;
    });
    
    // Botón de eliminar conversación
    document.getElementById('delete-conversation-btn').addEventListener('click', confirmDeleteConversation);
    
    // Botón de exportar conversación
    document.getElementById('export-btn').addEventListener('click', exportConversation);
    
    // Botón de reiniciar memoria
    document.getElementById('clear-memory-btn').addEventListener('click', confirmResetMemory);
    
    // Botón de búsqueda en documentos
    document.getElementById('document-search-btn').addEventListener('click', () => {
        toggleModal('document-search-modal', true);
    });
    
    // Botón de realizar búsqueda en documentos
    document.getElementById('do-document-search-btn').addEventListener('click', searchInDocuments);
    
    // Input de búsqueda en documentos con tecla Enter
    document.getElementById('document-search-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            searchInDocuments();
        }
    });
    
    // Toggle de barra lateral derecha en móvil
    document.getElementById('toggle-sidebar-btn').addEventListener('click', toggleRightSidebar);
}

// Inicialización de markdown y highlight.js
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
        breaks: true
    });
    
    // Inicializar highlight.js
    hljs.highlightAll();
}

// Inicializar pestañas
function initTabs() {
    // Pestañas de la barra lateral
    document.querySelectorAll('.sidebar-tabs .tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const tabName = e.target.dataset.tab;
            
            // Desactivar todas las pestañas
            document.querySelectorAll('.sidebar-tabs .tab-btn').forEach(b => {
                b.classList.remove('active');
            });
            document.querySelectorAll('.tab-panel').forEach(panel => {
                panel.classList.remove('active');
            });
            
            // Activar la pestaña seleccionada
            e.target.classList.add('active');
            document.getElementById(`${tabName}-tab`).classList.add('active');
        });
    });
    
    // Pestañas de vista previa de documento
    document.querySelectorAll('.document-tabs .tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const tabName = e.target.dataset.tab;
            
            // Desactivar todas las pestañas
            document.querySelectorAll('.document-tabs .tab-btn').forEach(b => {
                b.classList.remove('active');
            });
            document.querySelectorAll('.document-tab-content .tab-panel').forEach(panel => {
                panel.classList.remove('active');
            });
            
            // Activar la pestaña seleccionada
            e.target.classList.add('active');
            document.getElementById(`document-${tabName}-tab`).classList.add('active');
        });
    });
}

// Detectar preferencia de tema oscuro
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

function enableDarkMode() {
    document.body.classList.add('dark-mode');
    currentSettings.darkMode = true;
}

function disableDarkMode() {
    document.body.classList.remove('dark-mode');
    currentSettings.darkMode = false;
}

// ===== GESTIÓN DE CONVERSACIONES =====

// Cargar lista de conversaciones
async function loadConversations() {
    try {
        const response = await fetch('/api/conversations');
        
        if (!response.ok) {
            throw new Error('Error al cargar conversaciones');
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
        showToast('error', 'Error', 'No se pudieron cargar las conversaciones');
    }
}

// Mostrar lista de conversaciones
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
        conversationList.appendChild(emptyMessage);
        return;
    }
    
    // Crear elementos para cada conversación
    conversations.forEach(conversation => {
        const li = document.createElement('li');
        li.className = 'conversation-item';
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
        conversationList.appendChild(li);
    });
}

// Cargar una conversación
async function loadConversation(conversationId) {
    try {
        // Si ya estaba cargada, no hacer nada
        if (currentConversationId === conversationId) {
            return;
        }
        
        // Mostrar indicador de carga
        const messageContainer = document.getElementById('message-container');
        messageContainer.innerHTML = `
            <div class="loading-message">
                <div class="loader"></div>
                <div>Cargando conversación...</div>
            </div>
        `;
        
        const response = await fetch(`/api/conversations/${conversationId}`);
        
        if (!response.ok) {
            throw new Error('Error al cargar conversación');
        }
        
        const conversation = await response.json();
        
        // Actualizar conversación actual
        currentConversationId = conversationId;
        
        // Actualizar título
        document.getElementById('conversation-title').textContent = conversation.title || 'Sin título';
        
        // Actualizar clase active en la lista
        document.querySelectorAll('.conversation-item').forEach(item => {
            item.classList.remove('active');
        });
        document.querySelectorAll('.conversation-item').forEach(item => {
            if (item.querySelector('.conversation-item-title').textContent === conversation.title) {
                item.classList.add('active');
            }
        });
        
        // Mostrar mensajes
        displayMessages(conversation.messages);
        
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
        showToast('error', 'Error', 'No se pudo cargar la conversación');
    }
}

// Mostrar mensajes de una conversación
function displayMessages(messages) {
    const messageContainer = document.getElementById('message-container');
    messageContainer.innerHTML = '';
    
    if (!messages || messages.length === 0) {
        messageContainer.innerHTML = `
            <div class="welcome-message">
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

// Mostrar un mensaje de sistema
function displaySystemMessage(message) {
    const messageContainer = document.getElementById('message-container');
    
    const systemMessage = document.createElement('div');
    systemMessage.className = 'system-message';
    
    if (message.content.includes('Documento subido:')) {
        // Mensaje de documento subido
        systemMessage.innerHTML = `
            <div class="system-message-content">
                <i class="fas fa-file-upload"></i> ${escapeHTML(message.content)}
            </div>
        `;
    } else {
        // Otro tipo de mensaje de sistema
        systemMessage.innerHTML = `
            <div class="system-message-content">
                <i class="fas fa-info-circle"></i> ${escapeHTML(message.content)}
            </div>
        `;
    }
    
    messageContainer.appendChild(systemMessage);
}

// Mostrar un mensaje de chat
function displayChatMessage(message) {
    const messageContainer = document.getElementById('message-container');
    
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${message.role}`;
    
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
                    <button class="message-button copy-btn" title="Copiar al portapapeles">
                        <i class="fas fa-copy"></i>
                    </button>
                </div>
            </div>
        </div>
    `;
    
    // Botón de copiar
    messageDiv.querySelector('.copy-btn').addEventListener('click', () => {
        navigator.clipboard.writeText(message.content).then(() => {
            showToast('success', 'Copiado', 'Texto copiado al portapapeles');
        }).catch(() => {
            showToast('error', 'Error', 'No se pudo copiar el texto');
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

// Crear nueva conversación
async function createNewConversation() {
    try {
        const response = await fetch('/api/conversations', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                title: 'Nueva conversación'
            })
        });
        
        if (!response.ok) {
            throw new Error('Error al crear conversación');
        }
        
        const newConversation = await response.json();
        
        // Actualizar lista de conversaciones
        await loadConversations();
        
        // Cargar la nueva conversación
        await loadConversation(newConversation.id);
        
        showToast('success', 'Conversación creada', 'Nueva conversación iniciada');
    } catch (error) {
        console.error('Error:', error);
        showToast('error', 'Error', 'No se pudo crear la conversación');
    }
}

// Función para enviar un mensaje
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
        const messageResponse = await fetch(`/api/conversations/${currentConversationId}/messages`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                role: 'user',
                content: messageText
            })
        });
        
        if (!messageResponse.ok) {
            throw new Error('Error al enviar mensaje');
        }
        
        const messageData = await messageResponse.json();
        
        // Actualizar título si cambió
        if (messageData.title) {
            document.getElementById('conversation-title').textContent = messageData.title;
        }
        
        // Mostrar mensaje del usuario
        displayChatMessage({
            role: 'user',
            content: messageText,
            timestamp: new Date().toISOString()
        });
        
        // Mostrar indicador de escritura
        const messageContainer = document.getElementById('message-container');
        const typingIndicator = document.createElement('div');
        typingIndicator.className = 'message bot typing';
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
        const generateResponse = await fetch('/api/generate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
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
        
        // Mostrar respuesta
        displayChatMessage({
            role: 'bot',
            content: responseData.content,
            timestamp: responseData.timestamp
        });
        
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
        showToast('error', 'Error', 'No se pudo enviar o generar respuesta');
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

// Manejador para el input de mensaje (activar/desactivar botón)
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

// Editar título de conversación
function editConversationTitle() {
    if (!currentConversationId) return;
    
    const currentTitle = document.getElementById('conversation-title').textContent;
    const newTitle = prompt('Editar título de la conversación:', currentTitle);
    
    if (newTitle && newTitle.trim() !== '' && newTitle !== currentTitle) {
        updateConversationTitle(newTitle.trim());
    }
}

// Actualizar título de conversación en el servidor
async function updateConversationTitle(newTitle) {
    try {
        const response = await fetch(`/api/conversations/${currentConversationId}/title`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
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
        
        showToast('success', 'Título actualizado', 'El título de la conversación ha sido actualizado');
    } catch (error) {
        console.error('Error:', error);
        showToast('error', 'Error', 'No se pudo actualizar el título');
    }
}

// Confirmar eliminación de conversación
function confirmDeleteConversation() {
    if (!currentConversationId) return;
    
    if (confirm('¿Estás seguro de que deseas eliminar esta conversación? Esta acción no se puede deshacer.')) {
        deleteConversation();
    }
}

// Eliminar conversación
async function deleteConversation() {
    try {
        const conversationId = currentConversationId;
        
        const response = await fetch(`/api/conversations/${conversationId}`, {
            method: 'DELETE'
        });
        
        if (!response.ok) {
            throw new Error('Error al eliminar conversación');
        }
        
        // Resetear conversación actual
        currentConversationId = null;
        
        // Recargar lista de conversaciones
        await loadConversations();
        
        showToast('success', 'Conversación eliminada', 'La conversación ha sido eliminada');
    } catch (error) {
        console.error('Error:', error);
        showToast('error', 'Error', 'No se pudo eliminar la conversación');
    }
}

// Exportar conversación
function exportConversation() {
    if (!currentConversationId) return;
    
    window.open(`/api/conversations/${currentConversationId}/export`, '_blank');
}

// ===== GESTIÓN DE DOCUMENTOS =====

// Manejar subida de documentos
async function handleDocumentUpload(e) {
    if (!currentConversationId || documentUploadPending) return;
    
    const file = e.target.files[0];
    if (!file) return;
    
    try {
        documentUploadPending = true;
        
        // Mostrar notificación de carga
        showToast('info', 'Subiendo documento', 'El documento está siendo procesado...', 0);
        
        const formData = new FormData();
        formData.append('document', file);
        
        const response = await fetch(`/api/conversations/${currentConversationId}/documents`, {
            method: 'POST',
            body: formData
        });
        
        // Cerrar notificación de carga
        hideAllToasts();
        
        if (!response.ok) {
            throw new Error('Error al subir documento');
        }
        
        const data = await response.json();
        
        // Actualizar lista de documentos
        loadConversationDocuments(currentConversationId);
        
        // Actualizar mensajes para mostrar notificación de documento subido
        loadConversation(currentConversationId);
        
        showToast('success', 'Documento subido', `${file.name} ha sido procesado correctamente`);
    } catch (error) {
        console.error('Error:', error);
        showToast('error', 'Error', 'No se pudo procesar el documento');
    } finally {
        documentUploadPending = false;
        e.target.value = ''; // Resetear input file
    }
}

// Cargar documentos de una conversación
async function loadConversationDocuments(conversationId) {
    try {
        const response = await fetch(`/api/conversations/${conversationId}/documents`);
        
        if (!response.ok) {
            throw new Error('Error al cargar documentos');
        }
        
        const documents = await response.json();
        displayDocuments(documents);
    } catch (error) {
        console.error('Error:', error);
        const documentList = document.getElementById('document-list');
        documentList.innerHTML = '<li class="empty-message">Error al cargar documentos</li>';
    }
}

// Mostrar lista de documentos
function displayDocuments(documents) {
    const documentList = document.getElementById('document-list');
    documentList.innerHTML = '';
    
    if (!documents || documents.length === 0) {
        documentList.innerHTML = '<li class="empty-message">No hay documentos subidos aún.</li>';
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
                <i class="fas ${icon}"></i>
            </div>
            <div class="document-item-info">
                <div class="document-name">${escapeHTML(doc.originalName)}</div>
                <div class="document-date">${formattedDate}</div>
            </div>
            <button class="document-actions-btn">
                <i class="fas fa-ellipsis-v"></i>
            </button>
        `;
        
        // Evento para mostrar vista previa
        li.addEventListener('click', (e) => {
            if (!e.target.classList.contains('document-actions-btn') && 
                !e.target.classList.contains('fa-ellipsis-v')) {
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
            menu.innerHTML = `
                <ul>
                    <li data-action="preview">Ver documento</li>
                    <li data-action="search">Buscar en este documento</li>
                    <li data-action="delete" class="danger">Eliminar documento</li>
                </ul>
            `;
            
            // Posicionar menú
            menu.style.position = 'absolute';
            menu.style.top = `${e.clientY}px`;
            menu.style.left = `${e.clientX}px`;
            
            // Añadir al DOM
            document.body.appendChild(menu);
            
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
            
            // Cerrar menú al hacer clic fuera
            document.addEventListener('click', function closeMenu() {
                menu.remove();
                document.removeEventListener('click', closeMenu);
            });
        });
        
        documentList.appendChild(li);
    });
}

// Mostrar vista previa de documento
async function showDocumentPreview(docId) {
    if (!currentConversationId) return;
    
    try {
        // Mostrar modal con indicador de carga
        const modal = document.getElementById('document-preview-modal');
        toggleModal('document-preview-modal', true);
        
        document.getElementById('document-content').innerHTML = `
            <div class="loading-message">
                <div class="loader"></div>
                <div>Cargando documento...</div>
            </div>
        `;
        
        // Cargar datos del documento
        const response = await fetch(`/api/conversations/${currentConversationId}/documents/${docId}`);
        
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

// Confirmar eliminación de documento
function confirmDeleteDocument(docId, docName) {
    if (confirm(`¿Estás seguro de que deseas eliminar el documento "${docName}"? Esta acción no se puede deshacer.`)) {
        deleteDocument(docId);
    }
}

// Eliminar documento
async function deleteDocument(docId) {
    if (!currentConversationId) return;
    
    try {
        const response = await fetch(`/api/conversations/${currentConversationId}/documents/${docId}`, {
            method: 'DELETE'
        });
        
        if (!response.ok) {
            throw new Error('Error al eliminar documento');
        }
        
        // Actualizar lista de documentos
        loadConversationDocuments(currentConversationId);
        
        // Cerrar modal si está abierto
        toggleModal('document-preview-modal', false);
        
        showToast('success', 'Documento eliminado', 'El documento ha sido eliminado');
    } catch (error) {
        console.error('Error:', error);
        showToast('error', 'Error', 'No se pudo eliminar el documento');
    }
}

// Mostrar búsqueda en documentos
function showDocumentSearch() {
    if (!currentConversationId) return;
    
    // Mostrar modal
    toggleModal('document-search-modal', true);
    
    // Limpiar resultados anteriores
    document.getElementById('document-search-results').innerHTML = '';
    document.getElementById('document-search-input').value = '';
    
    // Enfocar el input
    setTimeout(() => {
        document.getElementById('document-search-input').focus();
    }, 100);
}

// Buscar en documentos
async function searchInDocuments() {
    if (!currentConversationId) return;
    
    const searchTerm = document.getElementById('document-search-input').value.trim();
    
    if (searchTerm.length < 3) {
        showToast('warning', 'Término demasiado corto', 'Ingresa al menos 3 caracteres para buscar');
        return;
    }
    
    try {
        // Mostrar indicador de carga
        document.getElementById('document-search-results').innerHTML = `
            <div class="loading-message">
                <div class="loader"></div>
                <div>Buscando...</div>
            </div>
        `;
        
        const response = await fetch(`/api/conversations/${currentConversationId}/documents/search/${encodeURIComponent(searchTerm)}`);
        
        if (!response.ok) {
            throw new Error('Error al buscar en documentos');
        }
        
        const results = await response.json();
        displaySearchResults(results, searchTerm);
    } catch (error) {
        console.error('Error:', error);
        document.getElementById('document-search-results').innerHTML = 'Error al realizar la búsqueda';
    }
}

// Mostrar resultados de búsqueda
function displaySearchResults(results, searchTerm) {
    const resultsContainer = document.getElementById('document-search-results');
    
    if (!results || results.length === 0) {
        resultsContainer.innerHTML = '<div class="empty-message">No se encontraron resultados para la búsqueda</div>';
        return;
    }
    
    resultsContainer.innerHTML = `<div class="search-summary">Se encontraron ${results.length} resultados</div>`;
    
    results.forEach(result => {
        const resultDiv = document.createElement('div');
        resultDiv.className = 'search-result-item';
        
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
                match => `<span class="result-highlight">${match}</span>`
            );
        }).join('<br><br>');
        
        resultDiv.innerHTML = `
            <div class="result-title">
                <i class="fas ${icon}"></i> ${escapeHTML(result.fileName)}
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
        
        resultsContainer.appendChild(resultDiv);
    });
}

// ===== CONTEXTO Y MEMORIA =====

// Cargar información de contexto
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

// Cargar datos de contexto
async function loadContextData(conversationId) {
    try {
        const response = await fetch(`/api/conversations/${conversationId}/context`);
        
        if (response.ok) {
            const contextData = await response.json();
            displayContextData(contextData);
        }
    } catch (error) {
        console.error('Error al cargar datos de contexto:', error);
        document.getElementById('entity-list').innerHTML = '<p class="empty-message">Error al cargar entidades</p>';
        document.getElementById('topic-list').innerHTML = '<p class="empty-message">Error al cargar temas</p>';
    }
}

// Mostrar datos de contexto
function displayContextData(contextData) {
    // Mostrar entidades
    const entityList = document.getElementById('entity-list');
    
    if (contextData.entities && contextData.entities.length > 0) {
        entityList.innerHTML = '';
        contextData.entities.forEach(entity => {
            const entityDiv = document.createElement('div');
            entityDiv.className = 'entity-item';
            entityDiv.textContent = entity.name;
            entityDiv.title = entity.type + (entity.description ? ': ' + entity.description : '');
            entityList.appendChild(entityDiv);
        });
    } else {
        entityList.innerHTML = '<p class="empty-message">No hay entidades detectadas</p>';
    }
    
    // Mostrar temas
    const topicList = document.getElementById('topic-list');
    
    if (contextData.topics && contextData.topics.length > 0) {
        topicList.innerHTML = '';
        contextData.topics.forEach(topic => {
            const topicDiv = document.createElement('div');
            topicDiv.className = 'topic-item';
            topicDiv.textContent = topic.name;
            topicList.appendChild(topicDiv);
        });
    } else {
        topicList.innerHTML = '<p class="empty-message">No hay temas identificados</p>';
    }
}

// Cargar datos de memoria
async function loadMemoryData(conversationId) {
    try {
        const response = await fetch(`/api/conversations/${conversationId}/memory`);
        
        if (response.ok) {
            const memoryData = await response.json();
            displayMemoryData(memoryData);
        }
    } catch (error) {
        console.error('Error al cargar datos de memoria:', error);
        document.getElementById('short-term-memory').innerHTML = '<p class="empty-message">Error al cargar memoria</p>';
        document.getElementById('long-term-memory').innerHTML = '<p class="empty-message">Error al cargar memoria</p>';
    }
}

// Mostrar datos de memoria
function displayMemoryData(memoryData) {
    // Memoria a corto plazo
    const shortTermDiv = document.getElementById('short-term-memory');
    
    if (memoryData.shortTerm && memoryData.shortTerm.length > 0) {
        shortTermDiv.innerHTML = '';
        
        // Mostrar solo los 5 items más recientes
        const recentItems = memoryData.shortTerm.slice(0, 5);
        
        recentItems.forEach(item => {
            const memoryItem = document.createElement('div');
            memoryItem.className = 'memory-item';
            
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
        shortTermDiv.innerHTML = '<p class="empty-message">No hay datos en memoria a corto plazo</p>';
    }
    
    // Memoria a largo plazo
    const longTermDiv = document.getElementById('long-term-memory');
    
    if (memoryData.longTerm && memoryData.longTerm.length > 0) {
        longTermDiv.innerHTML = '';
        
        // Mostrar solo los 5 items más relevantes
        const relevantItems = [...memoryData.longTerm]
            .sort((a, b) => (b.relevance || 0) - (a.relevance || 0))
            .slice(0, 5);
        
        relevantItems.forEach(item => {
            const memoryItem = document.createElement('div');
            memoryItem.className = 'memory-item';
            
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
        longTermDiv.innerHTML = '<p class="empty-message">No hay datos en memoria a largo plazo</p>';
    }
}

// Confirmar reinicio de memoria
function confirmResetMemory() {
    if (confirm('¿Estás seguro de que deseas reiniciar toda la memoria? Esta acción eliminará toda la memoria a corto y largo plazo, y no se puede deshacer.')) {
        resetMemory();
    }
}

// Reiniciar memoria
async function resetMemory() {
    try {
        const response = await fetch('/api/memory/reset', {
            method: 'POST'
        });
        
        if (!response.ok) {
            throw new Error('Error al reiniciar memoria');
        }
        
        // Recargar información de memoria
        if (currentConversationId) {
            await loadMemoryData(currentConversationId);
        }
        
        showToast('success', 'Memoria reiniciada', 'La memoria ha sido reiniciada correctamente');
    } catch (error) {
        console.error('Error:', error);
        showToast('error', 'Error', 'No se pudo reiniciar la memoria');
    }
}

// ===== CONFIGURACIÓN =====

// Cargar configuración
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

// Guardar configuración
function saveSettings() {
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
    fetch('/api/config', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            temperature: currentSettings.temperature,
            max_tokens: currentSettings.max_tokens,
            system_prompt: currentSettings.system_prompt,
            model: currentSettings.model
        })
    }).catch(error => {
        console.error('Error al guardar configuración en servidor:', error);
    });
    
    // Cerrar modal
    toggleModal('settings-modal', false);
    
    showToast('success', 'Configuración guardada', 'Los cambios han sido aplicados');
}

// Restablecer configuración por defecto
function resetSettings() {
    currentSettings = {
        temperature: 0.7,
        max_tokens: 2048,
        system_prompt: null,
        darkMode: false,
        autoScroll: true,
        memoryEnabled: true,
        globalMemoryEnabled: true,
        model: 'gemma3:27b'
    };
    
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
    
    showToast('info', 'Configuración restablecida', 'Se han restaurado los valores predeterminados');
}

// ===== UTILIDADES =====

// Comprobar estado del sistema
async function checkSystemStatus() {
    try {
        const response = await fetch('/api/system/status');
        
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

// Actualizar indicador de estado a error
function updateSystemStatusError() {
    const statusDot = document.querySelector('.status-dot');
    const statusText = document.querySelector('.status-text');
    
    statusDot.className = 'status-dot error';
    statusText.textContent = 'Error de conexión';
}

// Formatear fecha
function formatDate(date, includeTime = false) {
    if (!date) return '';
    
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    
    const dateOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    
    if (dateOnly.getTime() === today.getTime()) {
        // Hoy
        if (includeTime) {
            return `Hoy a las ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
        }
        return 'Hoy';
    } else if (dateOnly.getTime() === yesterday.getTime()) {
        // Ayer
        if (includeTime) {
            return `Ayer a las ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
        }
        return 'Ayer';
    } else {
        // Otra fecha
        const day = date.getDate().toString().padStart(2, '0');
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        const year = date.getFullYear();
        
        if (includeTime) {
            const hours = date.getHours().toString().padStart(2, '0');
            const minutes = date.getMinutes().toString().padStart(2, '0');
            return `${day}/${month}/${year} ${hours}:${minutes}`;
        }
        
        return `${day}/${month}/${year}`;
    }
}

// Formatear tamaño de archivo
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Escapar HTML
function escapeHTML(text) {
    if (!text) return '';
    
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// Escapar RegExp
function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Mostrar/ocultar modal
function toggleModal(modalId, show) {
    const modal = document.getElementById(modalId);
    
    if (show) {
        modal.classList.add('active');
        document.body.style.overflow = 'hidden'; // Evitar scroll
    } else {
        modal.classList.remove('active');
        document.body.style.overflow = ''; // Restaurar scroll
    }
}

// Mostrar toast de notificación
function showToast(type, title, message, duration = 5000) {
    const toastContainer = document.getElementById('toast-container');
    
    // Crear toast
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    // Determinar icono según tipo
    let icon = 'info-circle';
    if (type === 'success') icon = 'check-circle';
    else if (type === 'error') icon = 'exclamation-circle';
    else if (type === 'warning') icon = 'exclamation-triangle';
    
    toast.innerHTML = `
        <div class="toast-icon">
            <i class="fas fa-${icon}"></i>
        </div>
        <div class="toast-content">
            <div class="toast-title">${escapeHTML(title)}</div>
            <div class="toast-message">${escapeHTML(message)}</div>
        </div>
        <button class="toast-close">&times;</button>
    `;
    
    // Añadir al contenedor
    toastContainer.appendChild(toast);
    
    // Botón de cerrar
    toast.querySelector('.toast-close').addEventListener('click', () => {
        toast.classList.add('closing');
        setTimeout(() => {
            toast.remove();
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

// Ocultar todos los toasts
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

// Scroll al final de los mensajes
function scrollToBottom() {
    const messageContainer = document.getElementById('message-container');
    messageContainer.scrollTop = messageContainer.scrollHeight;
}

// Toggle sidebar derecha en móvil
function toggleRightSidebar() {
    const sidebar = document.querySelector('.right-sidebar');
    sidebar.classList.toggle('visible');
    
    const toggleBtn = document.getElementById('toggle-sidebar-btn');
    if (sidebar.classList.contains('visible')) {
        toggleBtn.innerHTML = '<i class="fas fa-chevron-right"></i>';
    } else {
        toggleBtn.innerHTML = '<i class="fas fa-chevron-left"></i>';
    }
}