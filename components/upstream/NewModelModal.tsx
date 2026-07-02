import { IconClose } from "../icons.tsx";
import { Modal } from "../Modal.tsx";

export function NewModelModal(
  { open, name, onClose, onNameChange, onSave }: {
    open: boolean;
    name: string;
    onClose: () => void;
    onNameChange: (value: string) => void;
    onSave: () => void;
  },
) {
  return (
    <Modal open={open} onClose={onClose}>
      {open && (
        <>
          <div class="modal-head">
            <h3>新增统一模型</h3>
            <button
              type="button"
              class="icon-btn"
              onClick={onClose}
              aria-label="关闭"
            >
              <IconClose />
            </button>
          </div>
          <div class="modal-body">
            <p class="page-sub" style="margin:0">
              新增的统一模型会出现在「模型管理」中，并立即作为当前上游模型的映射目标。
            </p>
            <div class="field">
              <label>模型名称（对外）</label>
              <input
                class="input"
                placeholder="例如 deepseek-chat"
                value={name}
                autofocus
                onInput={(e) =>
                  onNameChange((e.target as HTMLInputElement).value)}
              />
            </div>
          </div>
          <div class="modal-foot">
            <button type="button" class="btn" onClick={onClose}>
              取消
            </button>
            <button type="button" class="btn btn-primary" onClick={onSave}>
              创建并映射
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
