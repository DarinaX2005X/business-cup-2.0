'use client';

import { useEffect, useState } from 'react';
import { Toast } from '@/components/kit/Toast';
import { useT } from '@/i18n/client';

/** «Your data was deleted», once, after /profile deleted everything and came back to the landing. */
export function DeletedToast() {
  const { t } = useT();
  const [show, setShow] = useState(false);
  useEffect(() => {
    try {
      if (window.sessionStorage.getItem('irr_deleted') === '1') {
        window.sessionStorage.removeItem('irr_deleted');
        setShow(true);
      }
    } catch {
      /* storage blocked: nothing to show */
    }
  }, []);
  if (!show) return null;
  return (
    <div style={{ position: 'fixed', left: 16, right: 16, bottom: 24, zIndex: 40, display: 'flex', justifyContent: 'center', pointerEvents: 'none' }}>
      <div style={{ pointerEvents: 'auto' }}>
        <Toast message={t('profile.delete.doneTitle')} tone="neutral" onClose={() => setShow(false)} duration={5000} />
      </div>
    </div>
  );
}
