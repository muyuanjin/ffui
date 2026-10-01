// @vitest-environment jsdom
import { mount, flushPromises } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createI18n } from "vue-i18n";
import en from "@/locales/en";
import zh from "@/locales/zh-CN";
import FfmpegCommandDialog from "./FfmpegCommandDialog.vue";
import { Dialog } from "@/components/ui/dialog";
import contract from "../../../src-tauri/tests/ffmpeg-command-input-contract.json";

const backend = vi.hoisted(() => ({ enqueue: vi.fn(), parse: vi.fn() }));
vi.mock("@/lib/backend", () => ({ enqueueFfmpegJob: backend.enqueue, parseFfmpegCommand: backend.parse }));

const wrappers: ReturnType<typeof mount>[] = [];
const createWrapper = () => {
  const i18n = createI18n({ legacy: false, locale: "en", messages: { en, "zh-CN": zh } });
  const wrapper = mount(FfmpegCommandDialog, {
    props: { open: true },
    global: {
      plugins: [i18n],
      stubs: {
        Dialog: { template: "<div><slot /></div>" },
        DialogContent: { template: "<div><slot /></div>" },
        DialogTitle: { template: "<h2><slot /></h2>" },
        DialogDescription: { template: "<p><slot /></p>" },
      },
    },
  });
  wrappers.push(wrapper);
  return { wrapper, i18n };
};

const deferred = <Value>() => {
  let resolve!: (value: Value) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

describe("FFmpeg command dialog", () => {
  beforeEach(() => {
    backend.enqueue.mockReset().mockResolvedValue({});
    backend.parse.mockReset().mockImplementation(async (command: string) => {
      const valid = contract.valid.find((entry) => entry.command === command);
      if (valid) return [...valid.args];
      throw new Error(contract.invalid.find((entry) => entry.command === command)?.error ?? "Invalid command");
    });
  });
  afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));

  it.each(contract.valid)(
    "previews and enqueues $id with default name and lossless argv",
    async ({ command, args }) => {
      const { wrapper } = createWrapper();
      expect(wrapper.get('[data-testid="ffmpeg-command-advanced"]').attributes("open")).toBeUndefined();
      expect(wrapper.get('[data-testid="ffmpeg-command-submit"]').attributes("disabled")).toBeDefined();
      await wrapper.get('[data-testid="ffmpeg-command-input"]').setValue(command);
      await flushPromises();
      expect(backend.parse).toHaveBeenCalledWith(command);
      expect(backend.enqueue).not.toHaveBeenCalled();
      expect(
        wrapper
          .get('[data-testid="ffmpeg-command-preview"]')
          .findAll("li")
          .map((item) => item.text()),
      ).toEqual(args.map((argument) => argument || en.queue.command.emptyArgument));
      await wrapper.get("form").trigger("submit");
      await flushPromises();
      expect(backend.enqueue).toHaveBeenCalledWith({
        name: en.queue.command.defaultName,
        args,
        workingDirectory: null,
      });
      expect(wrapper.emitted("update:open")).toEqual([[false]]);
    },
  );

  it("keeps optional directory text and allows a custom task name", async () => {
    const { wrapper } = createWrapper();
    await wrapper.get('[data-testid="ffmpeg-command-input"]').setValue(contract.valid[0].command);
    await wrapper.get('[data-testid="ffmpeg-command-name"]').setValue("Analysis");
    await wrapper.get('[data-testid="ffmpeg-command-directory"]').setValue("D:\\输出 文件 ");
    await flushPromises();
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    expect(backend.enqueue).toHaveBeenCalledWith({
      name: "Analysis",
      args: contract.valid[0].args,
      workingDirectory: "D:\\输出 文件 ",
    });
  });

  it.each(contract.invalid.filter((entry) => entry.command))(
    "diagnoses $id without enqueueing",
    async ({ command, error }) => {
      const { wrapper } = createWrapper();
      await wrapper.get('[data-testid="ffmpeg-command-input"]').setValue(command);
      await flushPromises();
      await wrapper.get("form").trigger("submit");
      expect(backend.enqueue).not.toHaveBeenCalled();
      expect(wrapper.get('[role="alert"]').text()).toContain(error);
      expect(wrapper.find('[data-testid="ffmpeg-command-preview"]').exists()).toBe(false);
    },
  );

  it.each(["resolve", "reject"])("ignores an older parse %s when a new command is ready", async (outcome) => {
    const older = deferred<string[]>();
    backend.parse.mockImplementationOnce(() => older.promise);
    const { wrapper } = createWrapper();
    await wrapper.get('[data-testid="ffmpeg-command-input"]').setValue(contract.valid[0].command);
    await wrapper.get("form").trigger("submit");
    expect(backend.enqueue).not.toHaveBeenCalled();
    await wrapper.get('[data-testid="ffmpeg-command-input"]').setValue(contract.valid[1].command);
    await flushPromises();
    if (outcome === "resolve") older.resolve(contract.valid[0].args);
    else older.reject("Old error");
    await flushPromises();
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    expect(backend.enqueue.mock.calls[0][0].args).toEqual(contract.valid[1].args);
  });

  it.each(["close", "unmount", "prop", "empty"])("invalidates pending parsing on %s", async (action) => {
    const pending = deferred<string[]>();
    backend.parse.mockImplementationOnce(() => pending.promise);
    const { wrapper } = createWrapper();
    await wrapper.get('[data-testid="ffmpeg-command-input"]').setValue(contract.valid[0].command);
    if (action === "close") wrapper.findComponent(Dialog).vm.$emit("update:open", false);
    if (action === "unmount") wrapper.unmount();
    if (action === "prop") await wrapper.setProps({ open: false });
    if (action === "empty") await wrapper.get('[data-testid="ffmpeg-command-input"]').setValue("");
    pending.resolve(contract.valid[0].args);
    await flushPromises();
    if (action !== "unmount") {
      await wrapper.get("form").trigger("submit");
      expect(wrapper.find('[data-testid="ffmpeg-command-preview"]').exists()).toBe(false);
    }
    expect(backend.enqueue).not.toHaveBeenCalled();
  });

  it("prevents duplicate submission and preserves input for retry after enqueue failure", async () => {
    const pending = deferred<unknown>();
    backend.enqueue.mockImplementationOnce(() => pending.promise);
    const { wrapper } = createWrapper();
    await wrapper.get('[data-testid="ffmpeg-command-input"]').setValue(contract.valid[0].command);
    await flushPromises();
    await wrapper.get("form").trigger("submit");
    await wrapper.get("form").trigger("submit");
    expect(backend.enqueue).toHaveBeenCalledTimes(1);
    pending.reject("Invalid working directory");
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toBe("Invalid working directory");
    expect(wrapper.emitted("update:open")).toBeUndefined();
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    expect(backend.enqueue).toHaveBeenCalledTimes(2);
    expect(backend.enqueue.mock.calls[1]).toEqual(backend.enqueue.mock.calls[0]);
  });

  it("does not close a reopened dialog from a stale enqueue completion", async () => {
    const pending = deferred<unknown>();
    backend.enqueue.mockImplementationOnce(() => pending.promise);
    const { wrapper } = createWrapper();
    await wrapper.get('[data-testid="ffmpeg-command-input"]').setValue(contract.valid[0].command);
    await flushPromises();
    await wrapper.get("form").trigger("submit");
    await wrapper.setProps({ open: false });
    await wrapper.setProps({ open: true });
    pending.resolve({});
    await flushPromises();
    expect(wrapper.emitted("update:open")).toBeUndefined();
  });

  it("updates labels, risk and default name immediately when locale changes", async () => {
    const { wrapper, i18n } = createWrapper();
    await wrapper.get('[data-testid="ffmpeg-command-input"]').setValue(contract.valid[0].command);
    await flushPromises();
    i18n.global.locale.value = "zh-CN";
    await flushPromises();
    expect(wrapper.get("summary").text()).toBe(zh.queue.command.advanced);
    expect(wrapper.get('[data-testid="ffmpeg-command-risk"]').text()).toBe(zh.queue.command.risk);
    expect(wrapper.get('[data-testid="ffmpeg-command-name"]').attributes("placeholder")).toBe(
      zh.queue.command.defaultName,
    );
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    expect(backend.enqueue.mock.calls[0][0].name).toBe(zh.queue.command.defaultName);
  });
});
