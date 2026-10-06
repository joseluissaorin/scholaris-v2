import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/administracion/')({
  beforeLoad: () => { throw redirect({ to: '/administracion/cupones' }); },
});
