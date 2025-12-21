import { TextDecoder, TextEncoder } from "util";
import { CancellationToken, NotebookCellData, NotebookData, NotebookSerializer } from "vscode";
import { RawNotebookData } from "../types/Notebook";

export class DBNotebookSerializer implements NotebookSerializer {
  // public readonly label: string = "DB Contents Serializer";

  public async deserializeNotebook(
    data: Uint8Array,
    token: CancellationToken
  ): Promise<NotebookData> {
    var contents = new TextDecoder().decode(data); // convert to String to make JSON object

    // Read file contents
    let raw: RawNotebookData;
    try {
      raw = <RawNotebookData>JSON.parse(contents);
    } catch {
      raw = { cells: [], metadata: {} };
    }

    // Create array of Notebook cells for the VS Code API from file contents
    const cells = raw.cells.map((item) => {
      const cell = new NotebookCellData(item.kind, item.value, item.language);
      cell.metadata = item.metadata ?? {};
      cell.outputs = item.outputs ?? [];
      return cell;
    });

    // Pass read and formatted Notebook Data to VS Code to display Notebook with saved cells
    const bookData = new NotebookData(cells);
    bookData.metadata = {
      ...(raw.metadata ?? {}),
    };
    return bookData;
  }

  public async serializeNotebook(
    data: NotebookData,
    token: CancellationToken
  ): Promise<Uint8Array> {
    // Map the Notebook data into the format we want to save the Notebook data as
    let contents: RawNotebookData = {
      cells: [],
      metadata: {
        ...(data.metadata ?? {}),
      },
    };

    for (const cell of data.cells) {
      contents.cells.push({
        kind: cell.kind,
        language: cell.languageId,
        value: cell.value,
        metadata: cell.metadata ?? {},
        outputs: cell.outputs ?? [],
      });
    }

    // Give a string of all the data to save and VS Code will handle the rest
    return new TextEncoder().encode(JSON.stringify(contents, null, 1));
  }
}
