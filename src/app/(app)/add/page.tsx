import { UploadFlow } from "@/components/app/upload-flow";

export const metadata = { title: "Add" };

export default function Add() {
  return <UploadFlow welcome={false} />;
}
