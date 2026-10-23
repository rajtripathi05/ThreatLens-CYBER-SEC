import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router-dom";
import { Layout } from "@/components/Layout";
import { Spinner } from "@/components/ui/primitives";
import Overview from "@/pages/Overview";
import Analyzer from "@/pages/Analyzer";
import Evidence from "@/pages/Evidence";
import Incidents from "@/pages/Incidents";
import Methodology from "@/pages/Methodology";
import Demo from "@/pages/Demo";
import NotFound from "@/pages/NotFound";
import CampaignHub from "@/pages/campaigns/CampaignHub";
import CampaignStudio from "@/pages/campaigns/CampaignStudio";
import CampaignIntelligence from "@/pages/campaigns/CampaignIntelligence";

// Recharts is heavy: load the Research Lab on demand.
const Research = lazy(() => import("@/pages/Research"));

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Overview />} />
        <Route path="campaigns" element={<CampaignHub />} />
        <Route path="campaigns/studio" element={<CampaignStudio />} />
        <Route path="campaigns/intelligence" element={<CampaignIntelligence />} />
        <Route path="demo" element={<Demo />} />
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
