export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex h-screen flex-col">
      <h1>App</h1>
      {children}
    </div>
  );
}
