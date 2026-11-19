import { Route, Routes } from "react-router-dom";

import { AppLayout } from "./components/layout/AppLayout";
import { ProtectedRoute } from "./components/layout/ProtectedRoute";
import { RequireRole } from "./components/layout/RequireRole";
import { LEAD_ROLES } from "./lib/roles";
import AnalyticsPage from "./pages/AnalyticsPage";
import BrandAssetsPage from "./pages/BrandAssetsPage";
import ChatPage from "./pages/ChatPage";
import DashboardPage from "./pages/DashboardPage";
import HrPage from "./pages/HrPage";
import JobDetailPage from "./pages/JobDetailPage";
import LoginPage from "./pages/LoginPage";
import NotFoundPage from "./pages/NotFoundPage";
import NotificationsPage from "./pages/NotificationsPage";
import PodOnboardingPage from "./pages/PodOnboardingPage";
import PodsPage from "./pages/PodsPage";
import UsersAdminPage from "./pages/UsersAdminPage";
import VideoTypesAdminPage from "./pages/VideoTypesAdminPage";
import VoiceNotesAdminPage from "./pages/VoiceNotesAdminPage";
import WhatsAppAdminPage from "./pages/WhatsAppAdminPage";
// import ForgotPasswordPage from "./pages/ForgotPasswordPage"; // TODO: re-enable with the forgot-password link on LoginPage
import ResetPasswordPage from "./pages/ResetPasswordPage";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      {/* Forgot-password is built (backend + page) but hidden for now — to
          switch it on, uncomment this route, the import above and the link in
          LoginPage. The reset page below stays live so emailed links work. */}
      {/* <Route path="/forgot-password" element={<ForgotPasswordPage />} /> */}
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/jobs/:jobId" element={<JobDetailPage />} />
          <Route path="/notifications" element={<NotificationsPage />} />
          <Route
            path="/pods/new"
            element={
              <RequireRole roles={LEAD_ROLES}>
                <PodOnboardingPage />
              </RequireRole>
            }
          />
          <Route path="/pods/:podId/brand-assets" element={<BrandAssetsPage />} />
          <Route
            path="/pods"
            element={
              <RequireRole roles={LEAD_ROLES}>
                <PodsPage />
              </RequireRole>
            }
          />
          <Route
            path="/analytics"
            element={
              <RequireRole roles={LEAD_ROLES}>
                <AnalyticsPage />
              </RequireRole>
            }
          />
          {/* The bot reads the same numbers as /analytics, so it is gated
              the same way — the lead roles only (docs/04-permissions.md). */}
          <Route
            path="/bot"
            element={
              <RequireRole roles={LEAD_ROLES}>
                <ChatPage />
              </RequireRole>
            }
          />
          {/* People-ops' home. The Owner gets it too — they can see every
              roster surface — but nobody else: it is the roster, and the
              roster is not a company-wide read (docs/04-permissions.md). */}
          <Route
            path="/hr"
            element={
              <RequireRole roles={["hr", "owner"]}>
                <HrPage />
              </RequireRole>
            }
          />
          <Route
            path="/admin/users"
            element={
              <RequireRole roles={["owner", "hr"]}>
                <UsersAdminPage />
              </RequireRole>
            }
          />
          <Route
            path="/admin/voice-notes"
            element={
              <RequireRole roles={["owner", "fo"]}>
                <VoiceNotesAdminPage />
              </RequireRole>
            }
          />
          {/* Owner only, unlike the two admin pages above it. This one holds
              the credentials for a channel that can message the whole company
              from the business number, and spends money doing it — the same
              reasoning that makes ADMIN_ROLES the Owner alone
              (docs/04-permissions.md, docs/13-whatsapp.md). */}
          <Route
            path="/admin/whatsapp"
            element={
              <RequireRole roles={["owner"]}>
                <WhatsAppAdminPage />
              </RequireRole>
            }
          />
          <Route
            path="/admin/video-types"
            element={<RequireRole roles={["owner"]}><VideoTypesAdminPage /></RequireRole>}
          />
          {/* Anything unmatched renders inside the app chrome rather than as
              a blank page — a stale link should explain itself. */}
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
