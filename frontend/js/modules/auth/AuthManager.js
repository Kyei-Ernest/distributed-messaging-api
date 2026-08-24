/**
 * ============================================================================
 * AuthManager - Handles authentication (login, register, logout)
 * ============================================================================
 */
class AuthManager {
    constructor(app) {
        this.app = app;
    }

    async handleLogin(e) {
        e.preventDefault();
        const form = e.target;
        const username = document.getElementById('login-identifier').value.trim();
        const password = document.getElementById('login-password').value;

        if (!username || !password) {
            UI.showToast('Please fill in all fields', 'error');
            return;
        }

        const submitBtn = form.querySelector('button[type="submit"]');
        const originalText = submitBtn?.textContent || 'Sign In';
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = 'Logging in...';
        };

        try {
            const response = await api.login(username, password);

            // api.login already stores tokens in localStorage
            // Response structure: { tokens: { access, refresh }, user: {...} }
            if (response.tokens?.access || response.user) {
                console.log('✅ Login successful');

                await this.app.authManager.loadCurrentUserDetails();

                if (!this.app.currentUser || !this.app.currentUser.id) {
                    throw new Error('Failed to load user details after login');
                }

                UI.showToast('Login successful!', 'success');
                UI.showScreen('chat-screen');
                await this.app.initializeChat();
            } else {
                throw new Error('Invalid login response');
            }
        } catch (error) {
            console.error('Login failed:', error);
            UI.showToast(error.message || 'Login failed', 'error');
        } finally {
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = originalText;
            }
        }
    }

    async handleRegister(e) {
        e.preventDefault();
        const form = e.target;
        const username = document.getElementById('register-username').value.trim();
        const email = document.getElementById('register-email').value.trim();
        const password = document.getElementById('register-password').value;
        // Optional profile fields — sent through when provided.
        const firstName = document.getElementById('register-firstname')?.value.trim() || '';
        const lastName = document.getElementById('register-lastname')?.value.trim() || '';

        if (!username || !email || !password) {
            UI.showToast('Please fill in all fields', 'error');
            return;
        }

        try {
            await api.register({ username, email, password,
                first_name: firstName, last_name: lastName });
            UI.showToast('Registration successful! Please login.', 'success');

            document.getElementById('register-form').classList.add('hidden');
            document.getElementById('login-form').classList.remove('hidden');
        } catch (error) {
            console.error('Registration failed:', error);
            UI.showToast(error.message || 'Registration failed', 'error');
        }
    }

    handleLogout() {
        console.log('🚪 Logging out...');
        localStorage.removeItem(CONFIG.TOKEN_KEY);
        localStorage.removeItem(CONFIG.REFRESH_KEY);
        localStorage.removeItem(CONFIG.USER_KEY);
        ws.disconnect();
        this.app.currentUser = null;
        UI.showScreen('login-screen');
        UI.showToast('Logged out successfully', 'success');
    }

    setupMobileNavForLogin() {
        const mobileNav = document.querySelector('.mobile-bottom-nav');
        if (mobileNav) {
            mobileNav.style.display = 'none';
        }
    }

    async loadCurrentUserDetails() {
        try {
            console.log('Loading current user details from API...');
            const response = await api.request('/users/me/');

            if (!response || !response.id) {
                throw new Error('Invalid user response from API');
            }

            this.app.currentUser = {
                id: response.id,
                username: response.username,
                email: response.email,
                first_name: response.first_name,
                last_name: response.last_name
            };

            localStorage.setItem(CONFIG.USER_KEY, JSON.stringify(this.app.currentUser.id));
            console.log('✅ Current user loaded:', this.app.currentUser);
        } catch (error) {
            console.error('❌ Failed to load user details:', error);
            throw error;
        }
    }
}
