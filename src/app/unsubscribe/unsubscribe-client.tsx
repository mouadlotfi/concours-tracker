'use client';

import { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import styles from './unsubscribe.module.css';

type Status = { kind: 'ok' | 'err'; text: string } | null;

export default function UnsubscribeClient() {
  const searchParams = useSearchParams();
  const token = useMemo(() => searchParams.get('token') || '', [searchParams]);

  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [status, setStatus] = useState<Status>(null);

  const onUnsub = useCallback(async () => {
    if (!token) {
      setStatus({ kind: 'err', text: 'Lien invalide.' });
      return;
    }

    setLoading(true);
    setStatus(null);

    try {
      const res = await fetch('/api/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setStatus({ kind: 'err', text: 'Erreur.' });
        return;
      }

      if (data && data.ok) {
        setStatus({ kind: 'ok', text: data.message || 'Desabonne avec succes.' });
        setDone(true);
      } else {
        setStatus({ kind: 'err', text: (data && data.message) || 'Erreur.' });
      }
    } catch {
      setStatus({ kind: 'err', text: 'Erreur reseau.' });
    } finally {
      setLoading(false);
    }
  }, [token]);

  return (
    <main className={styles.card}>
      <div className={styles.icon}>x</div>
      <h1 className={styles.title}>Désabonnement</h1>
      <p className={styles.desc}>
        Vous ne recevrez plus de notifications par email concernant les nouveaux concours.
      </p>

      {!done && (
        <button
          className={`${styles.btn} ${loading ? styles.loading : ''}`}
          onClick={onUnsub}
          disabled={loading}
          type="button"
        >
          <span className={styles.tick} />
          <span className={styles.spinner} />
          <span className={styles.label}>Confirmer</span>
        </button>
      )}

      <div
        className={`${styles.status} ${
          status?.kind === 'ok' ? styles.statusOk : status?.kind === 'err' ? styles.statusErr : ''
        }`}
      >
        {status?.text || ''}
      </div>

      <a href="/" className={styles.back}>
        retour
      </a>
    </main>
  );
}
