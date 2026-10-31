import { useRef, useState } from 'react';
import { UiIcon } from './UiIcon';

/** File selection only. Parsing, validation and saving stay in the existing knowledge workflow. */
export function FileDropZone({ id, onFile }: { id: string; onFile: (file: File) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const depth = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [message, setMessage] = useState('');
  function select(files: FileList | null) {
    if (!files?.length) return;
    if (files.length !== 1) {
      setMessage('请一次选择一个文件。');
      return;
    }
    setMessage('');
    setFile(files[0]);
    onFile(files[0]);
  }
  return (
    <div
      className={`file-drop-zone ${dragging ? 'file-drop-zone--active' : ''}`}
      onDragEnter={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        depth.current++;
        setDragging(true);
      }}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
      }}
      onDragLeave={() => {
        depth.current = Math.max(0, depth.current - 1);
        if (!depth.current) setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        depth.current = 0;
        setDragging(false);
        select(event.dataTransfer.files);
      }}
    >
      <input
        ref={input}
        id={id}
        className="sr-only"
        type="file"
        accept=".pdf,.txt,.md,application/pdf,text/plain,text/markdown"
        onChange={(event) => select(event.target.files)}
        aria-describedby={`${id}-help`}
      />
      <span className="file-drop-icon">
        <UiIcon name={file ? 'document' : 'knowledge'} size={23} />
      </span>
      <div className="file-drop-copy">
        <strong>{dragging ? '松开即可选择文件' : file ? file.name : '把知识资料带进工作台'}</strong>
        <p>
          {file
            ? `${Math.max(1, Math.round(file.size / 1024))} KB · 已选择，保存后才会导入`
            : '拖放文件，或从电脑中选择。一次导入一份资料。'}
        </p>
        <small id={`${id}-help`}>PDF ≤ 3 MB · TXT / Markdown ≤ 800 KB</small>
      </div>
      <button type="button" className="file-picker-button" onClick={() => input.current?.click()}>
        {file ? '重新选择' : '选择文件'} <span>↗</span>
      </button>
      {message && (
        <p className="file-drop-feedback" role="alert">
          {message}
        </p>
      )}
    </div>
  );
}
