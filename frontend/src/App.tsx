import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "@/components/Layout";
import { Spinner } from "@/components/ui/primitives";
import Overview from "@/pages/Overview";
import Analyzer from "@/pages/Analyzer";
import Evidence from "@/pages/Evidence";
import Incidents from "@/pages/Incidents";
import Methodology from "@/pages/Methodology";
import SecurityTour from "@/pages/Demo";
import NotFound from "@/pages/NotFound";
import CampaignOverview from "@/pages/campaigns/CampaignOverview";
import CampaignReports from "@/pages/campaigns/CampaignReports";
import CampaignDemo from "@/pages/campaigns/CampaignDemo";
import CampaignStudio from "@/pages/campaigns/CampaignStudio";
import CampaignIntelligence from "@/pages/campaigns/CampaignIntelligence";

// Recharts is heavy: load the Research Lab on demand.
const Research = lazy(() => import("@/pages/Research"));

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<CampaignOverview />} />
        <Route path="campaigns" element={<Navigate to="/" replace />} />
        <Route path="campaigns/studio" element={<CampaignStudio />} />
        <Route path="campaigns/intelligence" element={<CampaignIntelligence />} />
        <Route path="campaigns/reports" element={<CampaignReports />} />
        <Route path="demo" element={<CampaignDemo />} />
        <Route path="security" element={<Overview />} />
        <Route path="security/tour" element={<SecurityTour />} />
        <Route path="analyzer" element={<Analyzer />} />
        <Route path="evidence" element={<Evidence />} />
        <Route path="research" element={<Suspense fallback={<Spinner label="Loading Research Lab" />}><Research /></Suspense>} />
        <Route path="incidents" element={<Incidents />} />
        <Route path="incidents/:id" element={<Incidents />} />
        <Route path="methodology" element={<Methodology />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
