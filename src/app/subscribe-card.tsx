'use client';

import { useCallback, useMemo, useState } from 'react';

import styles from './page.module.css';

type StatusKind = 'ok' | 'err' | null;

export function SubscribeCard() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [statusKind, setStatusKind] = useState<StatusKind>(null);
  const [statusText, setStatusText] = useState('');

  const canSubmit = useMemo(() => email.trim().length > 0 && !loading, [email, loading]);

  const onSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();

      const value = email.trim();
      if (!value) return;

      setLoading(true);
      setStatusKind(null);
      setStatusText('');

      try {
        const res = await fetch('/api/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: value }),
        });
        const data = await res.json().catch(() => ({}));

        if (res.ok) {
          setStatusKind('ok');
          setStatusText((data && data.message) || 'Abonnement confirme.');
          setEmail('');
        } else {
          setStatusKind('err');
          setStatusText((data && (data.detail || data.message)) || 'Erreur.');
        }
      } catch {
        setStatusKind('err');
        setStatusText('Erreur de connexion.');
      } finally {
        setLoading(false);
      }
    },
    [email]
  );

  return (
    <form className={styles.card} onSubmit={onSubmit} autoComplete="off" noValidate>
      <label className={styles.label} htmlFor="email">
        adresse email
      </label>
      <div className={styles.inputRow}>
        <input
          className={styles.input}
          type="email"
          id="email"
          name="email"
          placeholder="nom@exemple.com"
          required
          spellCheck={false}
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <button
          type="submit"
          className={`${styles.btnSubmit} ${loading ? styles.btnSubmitLoading : ''}`}
          disabled={!canSubmit}
        >
          S'abonner
        </button>
      </div>

      <div className={styles.status}>
        {statusKind && (
          <div className={`${styles.statusMsg} ${statusKind === 'ok' ? styles.ok : styles.err}`}>
            <span className={`${styles.dot} ${statusKind === 'ok' ? styles.okDot : styles.errDot}`} />
            {statusText}
          </div>
        )}
      </div>
    </form>
  );
}
