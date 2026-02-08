import { Suspense } from 'react';

import UnsubscribeClient from './unsubscribe-client';

export default function UnsubscribePage() {
  return (
    <Suspense fallback={null}>
      <UnsubscribeClient />
    </Suspense>
  );
}
