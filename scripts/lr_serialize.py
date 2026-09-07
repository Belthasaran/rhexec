#!/usr/bin/env python3
"""Load bsnes-mercury balanced via libretro, run a ROM, serialize (and optionally unserialize).

Used by rhstate1-mercury. Does not write BST by hand — retro_serialize copies the core blob.
"""
from __future__ import annotations

import argparse
import ctypes
import os
import sys

RETRO_API_VERSION = 1
RETRO_MEMORY_SYSTEM_RAM = 0
RETRO_DEVICE_JOYPAD = 1

RETRO_ENVIRONMENT_GET_CAN_DUPE = 3
RETRO_ENVIRONMENT_SET_PERFORMANCE_LEVEL = 8
RETRO_ENVIRONMENT_GET_SYSTEM_DIRECTORY = 9
RETRO_ENVIRONMENT_SET_PIXEL_FORMAT = 10
RETRO_ENVIRONMENT_SET_INPUT_DESCRIPTORS = 11
RETRO_ENVIRONMENT_GET_VARIABLE = 15
RETRO_ENVIRONMENT_SET_VARIABLES = 16
RETRO_ENVIRONMENT_GET_VARIABLE_UPDATE = 17
RETRO_ENVIRONMENT_GET_LIBRETRO_PATH = 19
RETRO_ENVIRONMENT_GET_LOG_INTERFACE = 27
RETRO_ENVIRONMENT_GET_CORE_ASSETS_DIRECTORY = 30
RETRO_ENVIRONMENT_GET_SAVE_DIRECTORY = 31
RETRO_ENVIRONMENT_SET_CONTROLLER_INFO = 35
RETRO_ENVIRONMENT_GET_CORE_OPTIONS_VERSION = 52

RETRO_LOG_DEBUG, RETRO_LOG_INFO, RETRO_LOG_WARN, RETRO_LOG_ERROR = range(4)


class retro_game_info(ctypes.Structure):
    _fields_ = [
        ("path", ctypes.c_char_p),
        ("data", ctypes.c_void_p),
        ("size", ctypes.c_size_t),
        ("meta", ctypes.c_char_p),
    ]


class retro_system_info(ctypes.Structure):
    _fields_ = [
        ("library_name", ctypes.c_char_p),
        ("library_version", ctypes.c_char_p),
        ("valid_extensions", ctypes.c_char_p),
        ("need_fullpath", ctypes.c_bool),
        ("block_extract", ctypes.c_bool),
    ]


KEEP = []


def keep(obj):
    KEEP.append(obj)
    return obj


def load_rom(path: str) -> bytes:
    with open(path, "rb") as f:
        return f.read()


def open_core(path: str) -> ctypes.CDLL:
    mode = getattr(ctypes, "RTLD_GLOBAL", None)
    if mode is not None:
        return ctypes.CDLL(path, mode=mode)
    return ctypes.CDLL(path)


def main() -> int:
    ap = argparse.ArgumentParser(description="libretro serialize helper for rhstate1-mercury")
    ap.add_argument("--core", required=True, help="bsnes_mercury_balanced_libretro.so / .dll")
    ap.add_argument("--rom", required=True, help="SFC to load (usually Technique A boot ROM)")
    ap.add_argument("--out", required=True, help="raw retro_serialize blob")
    ap.add_argument("--system-dir", default=None)
    ap.add_argument("--save-dir", default=None)
    ap.add_argument("--wait-wram-u8", nargs=2, type=lambda s: int(s, 0), metavar=("ADDR", "VALUE"))
    ap.add_argument("--max-frames", type=int, default=600)
    ap.add_argument("--verify-rom", default=None, help="original SFC to retro_unserialize against")
    args = ap.parse_args()

    if not os.path.isfile(args.core):
        print(f"core not found: {args.core}", file=sys.stderr)
        return 1
    if not os.path.isfile(args.rom):
        print(f"rom not found: {args.rom}", file=sys.stderr)
        return 1

    system_dir = os.path.abspath(args.system_dir or os.path.dirname(args.out) or ".")
    save_dir = os.path.abspath(args.save_dir or system_dir)
    os.makedirs(system_dir, exist_ok=True)
    os.makedirs(save_dir, exist_ok=True)

    system_dir_b = keep(ctypes.c_char_p(os.fsencode(system_dir)))
    save_dir_b = keep(ctypes.c_char_p(os.fsencode(save_dir)))
    core_path_b = keep(ctypes.c_char_p(os.fsencode(os.path.abspath(args.core))))

    LogPrintf = ctypes.CFUNCTYPE(None, ctypes.c_int, ctypes.c_char_p)

    @LogPrintf
    def log_printf(level, fmt):  # type: ignore[misc]
        return

    keep(log_printf)

    class retro_log_callback(ctypes.Structure):
        _fields_ = [("log", LogPrintf)]

    EnvFn = ctypes.CFUNCTYPE(ctypes.c_bool, ctypes.c_uint, ctypes.c_void_p)

    @EnvFn
    def environment(cmd, data):  # type: ignore[misc]
        if not data and cmd not in (RETRO_ENVIRONMENT_SET_VARIABLES,):
            # some SET_* pass NULL; still ack a few
            pass
        cmd_id = cmd & 0xFFFF
        if cmd_id == RETRO_ENVIRONMENT_GET_CAN_DUPE and data:
            ctypes.cast(data, ctypes.POINTER(ctypes.c_bool))[0] = True
            return True
        if cmd_id == RETRO_ENVIRONMENT_GET_SYSTEM_DIRECTORY and data:
            ctypes.cast(data, ctypes.POINTER(ctypes.c_char_p))[0] = system_dir_b
            return True
        if cmd_id in (RETRO_ENVIRONMENT_GET_SAVE_DIRECTORY, RETRO_ENVIRONMENT_GET_CORE_ASSETS_DIRECTORY) and data:
            ctypes.cast(data, ctypes.POINTER(ctypes.c_char_p))[0] = save_dir_b
            return True
        if cmd_id == RETRO_ENVIRONMENT_GET_LIBRETRO_PATH and data:
            ctypes.cast(data, ctypes.POINTER(ctypes.c_char_p))[0] = core_path_b
            return True
        if cmd_id == RETRO_ENVIRONMENT_SET_PIXEL_FORMAT:
            return True
        if cmd_id == RETRO_ENVIRONMENT_GET_LOG_INTERFACE and data:
            cb = ctypes.cast(data, ctypes.POINTER(retro_log_callback))
            cb.contents.log = log_printf
            return True
        if cmd_id == RETRO_ENVIRONMENT_GET_VARIABLE:
            return False
        if cmd_id == RETRO_ENVIRONMENT_GET_VARIABLE_UPDATE and data:
            ctypes.cast(data, ctypes.POINTER(ctypes.c_bool))[0] = False
            return True
        if cmd_id == RETRO_ENVIRONMENT_GET_CORE_OPTIONS_VERSION and data:
            ctypes.cast(data, ctypes.POINTER(ctypes.c_uint))[0] = 1
            return True
        if cmd_id in (
            RETRO_ENVIRONMENT_SET_PERFORMANCE_LEVEL,
            RETRO_ENVIRONMENT_SET_INPUT_DESCRIPTORS,
            RETRO_ENVIRONMENT_SET_VARIABLES,
            RETRO_ENVIRONMENT_SET_CONTROLLER_INFO,
        ):
            return True
        return False

    keep(environment)

    VideoFn = ctypes.CFUNCTYPE(None, ctypes.c_void_p, ctypes.c_uint, ctypes.c_uint, ctypes.c_size_t)
    AudioFn = ctypes.CFUNCTYPE(None, ctypes.c_int16, ctypes.c_int16)
    AudioBatchFn = ctypes.CFUNCTYPE(ctypes.c_size_t, ctypes.c_void_p, ctypes.c_size_t)
    PollFn = ctypes.CFUNCTYPE(None)
    InputFn = ctypes.CFUNCTYPE(ctypes.c_int16, ctypes.c_uint, ctypes.c_uint, ctypes.c_uint, ctypes.c_uint)

    @VideoFn
    def video_refresh(_data, _width, _height, _pitch):  # type: ignore[misc]
        return

    @AudioFn
    def audio_sample(_left, _right):  # type: ignore[misc]
        return

    @AudioBatchFn
    def audio_sample_batch(_data, frames):  # type: ignore[misc]
        return frames

    @PollFn
    def input_poll():  # type: ignore[misc]
        return

    @InputFn
    def input_state(_port, _device, _index, _id):  # type: ignore[misc]
        return 0

    keep(video_refresh)
    keep(audio_sample)
    keep(audio_sample_batch)
    keep(input_poll)
    keep(input_state)

    core = open_core(args.core)
    core.retro_api_version.restype = ctypes.c_uint
    core.retro_set_environment.argtypes = [EnvFn]
    core.retro_set_video_refresh.argtypes = [VideoFn]
    core.retro_set_audio_sample.argtypes = [AudioFn]
    core.retro_set_audio_sample_batch.argtypes = [AudioBatchFn]
    core.retro_set_input_poll.argtypes = [PollFn]
    core.retro_set_input_state.argtypes = [InputFn]
    core.retro_init.argtypes = []
    core.retro_deinit.argtypes = []
    core.retro_get_system_info.argtypes = [ctypes.POINTER(retro_system_info)]
    core.retro_load_game.argtypes = [ctypes.POINTER(retro_game_info)]
    core.retro_load_game.restype = ctypes.c_bool
    core.retro_unload_game.argtypes = []
    core.retro_run.argtypes = []
    core.retro_serialize_size.restype = ctypes.c_size_t
    core.retro_serialize.argtypes = [ctypes.c_void_p, ctypes.c_size_t]
    core.retro_serialize.restype = ctypes.c_bool
    core.retro_unserialize.argtypes = [ctypes.c_void_p, ctypes.c_size_t]
    core.retro_unserialize.restype = ctypes.c_bool
    core.retro_get_memory_data.argtypes = [ctypes.c_uint]
    core.retro_get_memory_data.restype = ctypes.c_void_p
    core.retro_get_memory_size.argtypes = [ctypes.c_uint]
    core.retro_get_memory_size.restype = ctypes.c_size_t
    if hasattr(core, "retro_set_controller_port_device"):
        core.retro_set_controller_port_device.argtypes = [ctypes.c_uint, ctypes.c_uint]

    api = core.retro_api_version()
    if api < RETRO_API_VERSION:
        print(f"libretro API {api} is too old", file=sys.stderr)
        return 1

    core.retro_set_environment(environment)
    core.retro_set_video_refresh(video_refresh)
    core.retro_set_audio_sample(audio_sample)
    core.retro_set_audio_sample_batch(audio_sample_batch)
    core.retro_set_input_poll(input_poll)
    core.retro_set_input_state(input_state)
    core.retro_init()

    def load_path(rom_path: str) -> tuple[retro_game_info, object]:
        raw = load_rom(rom_path)
        buf = keep(ctypes.create_string_buffer(raw, len(raw)))
        info = retro_game_info()
        path_b = keep(ctypes.c_char_p(os.fsencode(os.path.abspath(rom_path))))
        info.path = path_b
        info.data = ctypes.cast(buf, ctypes.c_void_p)
        info.size = len(raw)
        info.meta = None
        if not core.retro_load_game(ctypes.byref(info)):
            raise RuntimeError(f"retro_load_game failed: {rom_path}")
        return info, buf

    try:
        load_path(args.rom)
        if hasattr(core, "retro_set_controller_port_device"):
            core.retro_set_controller_port_device(0, RETRO_DEVICE_JOYPAD)

        wait = args.wait_wram_u8
        reached = wait is None
        last = None
        for frame in range(max(1, args.max_frames)):
            core.retro_run()
            if wait is None:
                continue
            addr, value = wait
            mem = core.retro_get_memory_data(RETRO_MEMORY_SYSTEM_RAM)
            size = core.retro_get_memory_size(RETRO_MEMORY_SYSTEM_RAM)
            if mem and size > addr:
                b = ctypes.cast(mem, ctypes.POINTER(ctypes.c_uint8))
                last = int(b[addr])
                if last == (value & 0xFF):
                    reached = True
                    print(f"wait matched $7E{addr:04X}={last:02X} at frame {frame + 1}", file=sys.stderr)
                    break
        if wait is not None and not reached:
            print(
                f"warning: timed out after {args.max_frames} frames waiting for "
                f"$7E{wait[0]:04X}={wait[1]:02X} (last={last})",
                file=sys.stderr,
            )

        size = int(core.retro_serialize_size())
        if size <= 0:
            print("retro_serialize_size is 0", file=sys.stderr)
            return 1
        blob = ctypes.create_string_buffer(size)
        if not core.retro_serialize(blob, size):
            print("retro_serialize failed", file=sys.stderr)
            return 1
        data = blob.raw
        # trim trailing zeros only if magic still present — keep full size; mercury uses capacity
        with open(args.out, "wb") as f:
            f.write(data)
        print(f"wrote {args.out} ({len(data)} bytes)", file=sys.stderr)

        if args.verify_rom:
            core.retro_unload_game()
            orig_len = os.path.getsize(args.verify_rom)
            boot_len = os.path.getsize(args.rom)
            try:
                load_path(args.verify_rom)
            except RuntimeError as e:
                print(str(e), file=sys.stderr)
                return 1
            verify_size = int(core.retro_serialize_size())
            ok = bool(core.retro_unserialize(blob, size))
            if not ok:
                if boot_len != orig_len or verify_size != size:
                    print(
                        f"mercury state from boot ROM ({boot_len} bytes, serialize {size}) "
                        f"does not unserialize against the original ROM ({orig_len} bytes, "
                        f"serialize_size {verify_size}); keep the state paired with the boot SFC",
                        file=sys.stderr,
                    )
                    return 2
                print("mercury unserialize against the original ROM failed", file=sys.stderr)
                return 2
            print("unserialize against --verify-rom succeeded", file=sys.stderr)
    finally:
        try:
            core.retro_unload_game()
        except Exception:
            pass
        try:
            core.retro_deinit()
        except Exception:
            pass
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:
        print(f"lr_serialize: {exc}", file=sys.stderr)
        sys.exit(1)
