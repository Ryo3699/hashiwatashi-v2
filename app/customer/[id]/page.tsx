import { notFound } from "next/navigation";
import { findCustomer } from "../../../server/store";
import Chat from "./Chat";

export const dynamic = "force-dynamic";

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const customer = findCustomer(id);
  if (!customer) notFound();
  return <Chat customerId={customer.id} name={customer.name} />;
}
