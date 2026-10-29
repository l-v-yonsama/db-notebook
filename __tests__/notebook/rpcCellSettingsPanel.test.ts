import { describe, expect, it, vi } from "vitest";
import { NotebookCellKind, Uri, window, workspace } from "vscode";
import { RpcCellInvokeSettingsPanel } from "../../src/panels/RpcCellInvokeSettingsPanel";

describe("RPC cell invoke settings panel", () => {
  it("shows settings without cell output and saves metadata to the cell", async () => {
    const cell = {
      kind: NotebookCellKind.Code,
      index: 0,
      metadata: { connectionName: "localRPC" },
      document: { languageId: "rpc-json", uri: Uri.file("/test/cell") },
      notebook: { uri: Uri.file("/test/notebook.dbn") },
      outputs: [],
    } as any;
    const service = { getDescriptor: vi.fn(async () => "message Request {}") } as any;
    RpcCellInvokeSettingsPanel.render(Uri.file("/extension"), cell, service);
    const panel = vi.mocked(window.createWebviewPanel).mock.results.at(-1)!.value;
    const onMessage = vi.mocked(panel.webview.onDidReceiveMessage).mock.calls[0][0];

    await onMessage({ command: "ready" });
    await vi.waitFor(() => expect(service.getDescriptor).toHaveBeenCalledWith(cell, false));
    expect(panel.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "initialize",
        value: expect.objectContaining({ metadataJson: "{}" }),
      })
    );
    expect(cell.outputs).toHaveLength(0);

    await onMessage({ command: "saveRpcCellMetadata", params: { metadataJson: '{"x-id":"42"}' } });
    await vi.waitFor(() => expect(workspace.applyEdit).toHaveBeenCalled());
    const edit = vi.mocked(workspace.applyEdit).mock.calls.at(-1)![0] as any;
    expect(edit.get(cell.notebook.uri)[0].metadata.rpc.metadataJson).toBe('{"x-id":"42"}');
    await vi.waitFor(() => expect(panel.dispose).toHaveBeenCalledOnce());
  });
});
