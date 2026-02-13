export function LoadingScreen() {
  return (
    <div className="loading-screen">
      <div className="loading-content">
        <div className="loading-spinner" />
        <span style={{ marginTop: '12px', fontSize: '13px' }}>Loading...</span>
      </div>
    </div>
  );
}
