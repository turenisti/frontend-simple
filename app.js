// Configuration
const API_URL = 'http://localhost:8003';

// State
let sessionId = null;
let isProcessing = false;

// User context - Get from parent page or localStorage
// Example: Set from your dashboard after login
let userContext = null;

// Initialize user context from localStorage or parent window
try {
    const storedContext = localStorage.getItem('user_context');
    if (storedContext) {
        userContext = JSON.parse(storedContext);
        console.log('✅ User context loaded:', userContext);
    } else {
        console.log('ℹ️  No user context found (admin mode)');
    }
} catch (e) {
    console.warn('Could not load user context:', e);
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    console.log('Page loaded, initializing...');
    checkHealth();
    setupEventListeners();
});

function setupEventListeners() {
    const input = document.getElementById('messageInput');
    input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !isProcessing) {
            sendMessage();
        }
    });
}

async function checkHealth() {
    try {
        console.log('Checking API health at:', `${API_URL}/health`);
        const response = await fetch(`${API_URL}/health`);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        console.log('Health check response:', data);

        if (data.status === 'healthy') {
            updateStatus(`✓ Connected - ${data.provider} (${data.model})`, 'success');
        } else {
            updateStatus('⚠ API Degraded', 'warning');
        }
    } catch (error) {
        console.error('Health check failed:', error);
        updateStatus('✗ Cannot connect to API', 'error');
    }
}

function updateStatus(text, type) {
    const statusText = document.getElementById('statusText');
    statusText.textContent = text;
}

async function sendMessage() {
    const input = document.getElementById('messageInput');
    const message = input.value.trim();

    if (!message || isProcessing) return;

    // Clear input
    input.value = '';
    isProcessing = true;
    updateSendButton(false);

    // Add user message to chat
    addMessage('user', message);

    // Show typing indicator
    showTypingIndicator();

    try {
        // Prepare payload
        const payload = {
            message: message,
            user_id: userContext?.user_id || 'web-user@example.com',
            language: 'id'
        };

        if (sessionId) {
            payload.session_id = sessionId;
        }

        // Add user context if available (merchant authorization)
        if (userContext) {
            payload.user_context = userContext;
        }

        // Call streaming endpoint
        const response = await fetch(`${API_URL}/chat/stream`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        // Process stream
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let aiMessage = '';
        let aiMessageElement = null;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value);
            const lines = chunk.split('\n');

            for (const line of lines) {
                if (!line.trim()) continue;

                if (line.startsWith('event:')) {
                    // Event type (we can ignore for now)
                } else if (line.startsWith('data:')) {
                    const dataStr = line.substring(5).trim();

                    try {
                        const data = JSON.parse(dataStr);

                        // Handle session_id
                        if (data.session_id) {
                            sessionId = data.session_id;
                        }

                        // Handle AI message chunks
                        if (data.chunk) {
                            // Remove typing indicator on first chunk
                            if (!aiMessageElement) {
                                removeTypingIndicator();
                                aiMessageElement = addMessage('assistant', '');
                            }

                            aiMessage += data.chunk;
                            aiMessageElement.textContent = aiMessage;

                            // Auto-scroll
                            scrollToBottom();
                        }

                        // Handle completion data
                        if (data.collected_data !== undefined) {
                            updateCollectedData(data.collected_data);
                            updateMissingFields(data.missing_fields);
                            updateCompleteStatus(data.is_complete);

                            if (data.token_usage) {
                                updateTokenUsage(data.token_usage);
                            }
                        }

                        // Handle errors
                        if (data.error) {
                            removeTypingIndicator();
                            addMessage('assistant', `Error: ${data.error}`);
                        }

                    } catch (e) {
                        console.error('Parse error:', e);
                    }
                }
            }
        }

    } catch (error) {
        removeTypingIndicator();
        addMessage('assistant', `Terjadi kesalahan: ${error.message}`);
        console.error('Error:', error);
    } finally {
        isProcessing = false;
        updateSendButton(true);
    }
}

function addMessage(role, content) {
    const messagesContainer = document.getElementById('chatMessages');

    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${role}`;

    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';
    contentDiv.textContent = content;

    messageDiv.appendChild(contentDiv);
    messagesContainer.appendChild(messageDiv);

    scrollToBottom();

    return contentDiv;
}

function showTypingIndicator() {
    const messagesContainer = document.getElementById('chatMessages');

    const messageDiv = document.createElement('div');
    messageDiv.className = 'message assistant';
    messageDiv.id = 'typing-indicator';

    const typingDiv = document.createElement('div');
    typingDiv.className = 'typing-indicator';
    typingDiv.innerHTML = '<span></span><span></span><span></span>';

    messageDiv.appendChild(typingDiv);
    messagesContainer.appendChild(messageDiv);

    scrollToBottom();
}

function removeTypingIndicator() {
    const indicator = document.getElementById('typing-indicator');
    if (indicator) {
        indicator.remove();
    }
}

function scrollToBottom() {
    const messagesContainer = document.getElementById('chatMessages');
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function updateSendButton(enabled) {
    const sendBtn = document.getElementById('sendBtn');
    sendBtn.disabled = !enabled;
    sendBtn.textContent = enabled ? 'Kirim' : 'Mengirim...';
}

function updateCollectedData(data) {
    const container = document.getElementById('collectedDataContainer');

    if (Object.keys(data).length === 0) {
        container.innerHTML = '<div class="data-item" style="color: #999;">Belum ada data...</div>';
        return;
    }

    const fieldNames = {
        merchant_id: 'Merchant ID',
        report_type: 'Jenis Report',
        status_filter: 'Status Filter',
        date_range: 'Periode',
        output_format: 'Format Output',
        cron_schedule: 'Jadwal',
        timezone: 'Timezone',
        email_recipients: 'Email Penerima'
    };

    let html = '';
    for (const [key, value] of Object.entries(data)) {
        if (value) {
            const label = fieldNames[key] || key;
            const displayValue = Array.isArray(value) ? value.join(', ') : value;
            html += `
                <div class="data-item">
                    <strong>${label}</strong>
                    ${displayValue}
                </div>
            `;
        }
    }

    container.innerHTML = html;
}

function updateMissingFields(fields) {
    const container = document.getElementById('missingFieldsContainer');

    if (!fields || fields.length === 0) {
        container.innerHTML = '';
        return;
    }

    const fieldNames = {
        merchant_id: 'Merchant ID',
        report_type: 'Jenis Report',
        status_filter: 'Status Filter',
        date_range: 'Periode',
        output_format: 'Format Output',
        cron_schedule: 'Jadwal',
        timezone: 'Timezone',
        email_recipients: 'Email Penerima'
    };

    const missingNames = fields.map(f => fieldNames[f] || f).join(', ');

    container.innerHTML = `
        <div class="missing-fields">
            <strong>⚠ Masih kurang:</strong><br>
            ${missingNames}
        </div>
    `;
}

function updateCompleteStatus(isComplete) {
    const confirmBtn = document.getElementById('confirmBtn');
    confirmBtn.style.display = isComplete ? 'block' : 'none';
}

function updateTokenUsage(usage) {
    const container = document.getElementById('tokenUsageContainer');

    if (!usage) {
        container.innerHTML = '';
        return;
    }

    container.innerHTML = `
        <div class="token-usage">
            <strong>💰 Token Usage:</strong><br>
            Input: ${usage.input_tokens} | Output: ${usage.output_tokens}<br>
            Total: ${usage.total_tokens} tokens
        </div>
    `;
}

async function confirmSchedule() {
    if (!sessionId) {
        alert('Session tidak ditemukan!');
        return;
    }

    const confirmBtn = document.getElementById('confirmBtn');
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Membuat jadwal...';

    try {
        const response = await fetch(`${API_URL}/confirm`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                session_id: sessionId,
                user_id: 'web-user@example.com'
            })
        });

        const result = await response.json();

        if (result.success) {
            addMessage('assistant', `✅ ${result.message}\n\nSchedule ID: ${result.schedule_id}\nConfig ID: ${result.config_id}`);
            confirmBtn.style.display = 'none';

            // Reset session for new conversation
            setTimeout(() => {
                if (confirm('Mau buat jadwal baru lagi?')) {
                    location.reload();
                }
            }, 2000);
        } else {
            addMessage('assistant', `❌ Gagal: ${result.message}`);
            confirmBtn.disabled = false;
            confirmBtn.textContent = '✓ Buat Jadwal Report';
        }

    } catch (error) {
        addMessage('assistant', `❌ Error: ${error.message}`);
        confirmBtn.disabled = false;
        confirmBtn.textContent = '✓ Buat Jadwal Report';
    }
}
