import { Link } from "react-router-dom";
import { EmptyState, PageHeader } from "@/components/ui/primitives";

export default function NotFound() {
  return (
    <>
      <PageHeader title="Page not found" />
      <EmptyState title="This page does not exist" action={<Link to="/" className="text-sm text-accent underline">Back to the overview</Link>}>
        Check the address, or use the navigation to find what you need.
      </EmptyState>
    </>
  );
}
