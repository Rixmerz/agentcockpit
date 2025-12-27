# Tauri IPC Service Contract

**Location:** `src/services/tauriService.ts`

**Purpose:** Centralized service for all IPC communication between React frontend and Tauri/Rust backend. All Tauri command invocations go through this service.

## Exported Functions

```typescript
export async function invokeCommand<T, R = unknown>(
  command: string,
  payload?: T
): Promise<R>

export async function greet(name: string): Promise<string>

export async function executeCommand(command: string): Promise<string>
```

## Types
- `IpcRequest<T>` - Request structure
- `IpcResponse<T>` - Response structure

## Error Handling
- All functions throw `Error` with message `IPC Error [command]: details`
- Errors are caught and formatted for debugging

## Backend Commands
- `greet` - Demo command, receives name parameter
- `execute_command` - Execute shell command (future)

## Dependencies
- `@tauri-apps/api/core` - Tauri invoke function

## Usage Pattern
```typescript
try {
  const result = await invokeCommand<{name: string}, string>(
    "greet",
    { name: "John" }
  );
} catch (error) {
  console.error(error.message);
}
```

## Breaking Changes
- Removing exported function breaks all callers
- Changing function signature breaks callers
- Changing command names breaks backend synchronization
