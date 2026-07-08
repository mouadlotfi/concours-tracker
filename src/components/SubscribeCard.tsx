import { html, raw } from 'hono/html';

export const SubscribeCard = ({ siteKey }: { siteKey?: string }) => {
  const turnstileSiteKey = siteKey || '1x00000000000000000000AA';
  return html`
    <form class="card" id="subscribe-form" autocomplete="off" novalidate>
      <script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" async defer></script>
      <label class="label" for="email">
        adresse email
      </label>
      <div class="inputRow">
        <input
          class="input"
          type="email"
          id="email"
          name="email"
          placeholder="nom@exemple.com"
          required
          spellcheck="false"
          autocomplete="email"
        />
        <button
          type="submit"
          id="submit-btn"
          class="btnSubmit"
          disabled
        >
          S'abonner
        </button>
      </div>

      <div id="turnstile-widget-subscribe" style="display: flex; justify-content: flex-start;"></div>

      <div class="status" id="status-container"></div>
    </form>

    <script>
      (function() {
        const form = document.getElementById('subscribe-form');
        const emailInput = document.getElementById('email');
        const submitBtn = document.getElementById('submit-btn');
        const statusContainer = document.getElementById('status-container');
        
        let turnstileToken = null;
        let widgetId = null;
        let loading = false;

        function updateSubmitButton() {
          const val = emailInput.value.trim();
          if (val && turnstileToken && !loading) {
            submitBtn.removeAttribute('disabled');
          } else {
            submitBtn.setAttribute('disabled', 'true');
          }
        }

        emailInput.addEventListener('input', updateSubmitButton);

        function renderTurnstile() {
          if (window.turnstile) {
            try {
              widgetId = window.turnstile.render('#turnstile-widget-subscribe', {
                sitekey: ${raw(JSON.stringify(turnstileSiteKey))},
                callback: function(token) {
                  turnstileToken = token;
                  updateSubmitButton();
                },
                'error-callback': function() {
                  turnstileToken = null;
                  updateSubmitButton();
                },
                'expired-callback': function() {
                  turnstileToken = null;
                  updateSubmitButton();
                }
              });
            } catch (e) {
              console.error('Turnstile render error:', e);
            }
          }
        }

        // Wait for Turnstile
        const interval = setInterval(function() {
          if (window.turnstile) {
            clearInterval(interval);
            renderTurnstile();
          }
        }, 100);

        function showStatus(kind, msg) {
          statusContainer.innerHTML = '';
          if (!kind) return;
          const div = document.createElement('div');
          div.className = 'statusMsg ' + (kind === 'ok' ? 'ok' : 'err');
          const span = document.createElement('span');
          span.className = 'dot ' + (kind === 'ok' ? 'okDot' : 'errDot');
          div.appendChild(span);
          div.appendChild(document.createTextNode(' ' + msg));
          statusContainer.appendChild(div);
        }

        form.addEventListener('submit', async function(e) {
          e.preventDefault();
          const val = emailInput.value.trim();
          if (!val || !turnstileToken) return;

          loading = true;
          updateSubmitButton();
          submitBtn.classList.add('btnSubmitLoading');
          showStatus(null, '');

          try {
            const res = await fetch('/api/subscribe', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ email: val, turnstileToken })
            });
            const data = await res.json().catch(function() { return {}; });

            if (res.ok) {
              showStatus('ok', data.message || 'Abonnement confirme.');
              emailInput.value = '';
            } else {
              showStatus('err', data.detail || data.message || 'Erreur.');
            }
          } catch (err) {
            showStatus('err', 'Erreur de connexion.');
          } finally {
            loading = false;
            submitBtn.classList.remove('btnSubmitLoading');
            if (window.turnstile && widgetId !== null) {
              try { window.turnstile.reset(widgetId); } catch(e){}
            }
            turnstileToken = null;
            updateSubmitButton();
          }
        });
      })();
    </script>
  `;
};
