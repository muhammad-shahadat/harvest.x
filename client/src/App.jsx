import { Routes, Route, Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from './AuthContext';
import Layout from './components/Layout';
import Login from './pages/Login';
import Home from './pages/Home';
import Profile from './pages/Profile';
import ApplyFarmer from './pages/ApplyFarmer';
import ApplyBuyer from './pages/ApplyBuyer';
import AdminApplications from './pages/AdminApplications';
import AdminApplicationDetail from './pages/AdminApplicationDetail';
import AdminUsers from './pages/AdminUsers';
import ComingSoon from './pages/ComingSoon';

// Only logged-in users (optionally only certain roles) can open the page inside.
function Protected({ roles, children }) {
  const { user, loading } = useAuth();
  const { t } = useTranslation();
  if (loading) return <p className="center muted">{t('common.loading')}</p>;
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<Protected><Home /></Protected>} />
        <Route path="/profile" element={<Protected><Profile /></Protected>} />
        <Route path="/apply/farmer" element={<Protected roles={['general_user']}><ApplyFarmer /></Protected>} />
        <Route path="/apply/buyer" element={<Protected roles={['general_user']}><ApplyBuyer /></Protected>} />
        <Route path="/admin" element={<Navigate to="/admin/applications" replace />} />
        <Route path="/admin/applications" element={<Protected roles={['admin']}><AdminApplications /></Protected>} />
        <Route path="/admin/applications/:kind/:userId" element={<Protected roles={['admin']}><AdminApplicationDetail /></Protected>} />
        <Route path="/admin/users" element={<Protected roles={['admin']}><AdminUsers /></Protected>} />
        <Route path="/operator" element={<Protected roles={['operator']}><ComingSoon /></Protected>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
