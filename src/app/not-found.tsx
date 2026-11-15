import { Lost } from '@/components/public/Lost';

/** Any address the product does not have: the product's header and a way back. */
export default function NotFound() {
  return <Lost kind="missing" />;
}
