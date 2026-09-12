import { Redirect } from 'expo-router';

/** INS-099: the QA dashboard became the Home tab. Kept one release for old links. */
export default function DashboardRedirect() {
  return <Redirect href="/" />;
}
