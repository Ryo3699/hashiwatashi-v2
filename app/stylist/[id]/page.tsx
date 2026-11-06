import { notFound } from "next/navigation";
import { findCustomer } from "../../../server/store";
import Board from "./Board";

export const dynamic = "force-dynamic";

export default async function StylistPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const customer = findCustomer(id);
  if (!customer) notFound();
  return <Board customerId={customer.id} name={customer.name} />;
}
