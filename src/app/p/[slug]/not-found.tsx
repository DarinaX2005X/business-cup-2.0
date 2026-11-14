import { PublicProofMissing } from '@/components/progress/PublicProof';
import { getT } from '@/i18n/messages';

export default function NotFound() {
  return <PublicProofMissing t={getT('en')} />;
}
