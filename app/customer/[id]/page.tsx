import { notFound } from "next/navigation";
import { isPublicMode } from "../../../server/public";
import { findCustomer } from "../../../server/store";
import Chat from "./Chat";

export const dynamic = "force-dynamic";

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const customer = findCustomer(id);
  if (!customer) notFound();
  const notice = isPublicMode() ? "架空の内容でお試しください。答えは Claude に送られます。" : undefined;
  return <Chat customerId={customer.id} name={customer.name} notice={notice} />;
}
