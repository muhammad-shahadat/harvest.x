import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from './AuthContext';
import Layout from './components/Layout';
import Login from './pages/Login';
import Home from './pages/Home';
import Profile from './pages/Profile';
import ApplyFarmer from './pages/ApplyFarmer';
import ApplyBuyer from './pages/ApplyBuyer';
import AdminLogin from './pages/AdminLogin';
import AdminHome from './pages/AdminHome';
import AdminApplications from './pages/AdminApplications';
import AdminApplicationDetail from './pages/AdminApplicationDetail';
import AdminUsers from './pages/AdminUsers';
import ComingSoon from './pages/ComingSoon';
import DistrictPage from './pages/DistrictPage';
import UpazilaPage from './pages/UpazilaPage';
import Search from './pages/Search';
import ListingDetail from './pages/ListingDetail';
import FarmerListings from './pages/FarmerListings';
import ListingForm from './pages/ListingForm';
import AdminListings from './pages/AdminListings';
import AdminListingDetail from './pages/AdminListingDetail';
import AdminPrices from './pages/AdminPrices';
import AdminCrops from './pages/AdminCrops';

// Only logged-in users (optionally only certain roles) can open the page inside.
function Protected({ roles, children }) {
  const { user, loading } = useAuth();
  const { t } = useTranslation();
  const { pathname } = useLocation();
  if (loading) return <p className="center muted">{t('common.loading')}</p>;
  // admin pages have their own sign-in page
  if (!user) return <Navigate to={pathname.startsWith('/admin') ? '/admin/login' : '/login'} replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<Home />} />
        <Route path="/profile" element={<Protected><Profile /></Protected>} />
        <Route path="/apply/farmer" element={<Protected roles={['general_user']}><ApplyFarmer /></Protected>} />
        <Route path="/apply/buyer" element={<Protected roles={['general_user']}><ApplyBuyer /></Protected>} />
        <Route path="/district/:id" element={<DistrictPage />} />
        <Route path="/upazila/:id" element={<UpazilaPage />} />
        <Route path="/search" element={<Search />} />
        <Route path="/listings/:id" element={<ListingDetail />} />
        <Route path="/farmer/listings" element={<Protected roles={['farmer']}><FarmerListings /></Protected>} />
        <Route path="/farmer/listings/new" element={<Protected roles={['farmer']}><ListingForm /></Protected>} />
        <Route path="/farmer/listings/:id/edit" element={<Protected roles={['farmer']}><ListingForm /></Protected>} />
        <Route path="/admin/login" element={<AdminLogin />} />
        <Route path="/admin" element={<Protected roles={['admin']}><AdminHome /></Protected>} />
        <Route path="/admin/applications" element={<Protected roles={['admin']}><AdminApplications /></Protected>} />
        <Route path="/admin/applications/:kind/:userId" element={<Protected roles={['admin']}><AdminApplicationDetail /></Protected>} />
        <Route path="/admin/users" element={<Protected roles={['admin']}><AdminUsers /></Protected>} />
        <Route path="/admin/listings" element={<Protected roles={['admin']}><AdminListings /></Protected>} />
        <Route path="/admin/listings/:id" element={<Protected roles={['admin']}><AdminListingDetail /></Protected>} />
        <Route path="/admin/prices" element={<Protected roles={['admin']}><AdminPrices /></Protected>} />
        <Route path="/admin/crops" element={<Protected roles={['admin']}><AdminCrops /></Protected>} />
        <Route path="/operator" element={<Protected roles={['operator']}><ComingSoon /></Protected>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
