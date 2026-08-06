import App from '@/components/App.jsx';

/**
 * The whole UI is a client app behind a login — every screen renders
 * user-specific data, so there is nothing worth server-rendering here.
 */
export default function Page() {
  return <App />;
}
