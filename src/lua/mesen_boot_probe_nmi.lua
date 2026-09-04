-- Headless boot-restore probe. RESULT_DIR / TIMEOUT_FRAMES injected by writeBootProbeScript.
-- Passes if WRAM $7E0010 becomes non-zero (SMW NMI ran). Stops the emu either way.

local frame = 0
local finished = false
local nmi_frame = 0
local last_10 = 0
local last_pc = 0
local last_spc = 0
local last_0100 = 0
local last_1dfb = 0
local last_4200 = 0
local last_2140 = 0
local last_2141 = 0
local last_2142 = 0
local last_1dff = 0
local last_aram02 = 0
local last_aram06 = 0
local last_ch31 = 0
local last_aram0388 = 0
local last_spc_y = 0
local last_spc_a = 0
local last_spc_x = 0
local last_spc_sp = 0
local last_cpu_a = 0
local last_cpu_p = 0
local last_dest_lo = 0
local last_dest_hi = 0
local last_aram_pc = 0
local last_aram_11b0 = 0
local last_aram_0549 = 0
local last_f1 = 0
local last_fa = 0
local last_fd = 0
local last_stack_ret = 0
local last_tramp0 = 0
local result_path = RESULT_DIR .. "/nmi_probe.json"
local done_path = RESULT_DIR .. "/done"
local failed_path = RESULT_DIR .. "/failed"

local function memtypes()
  local mt = emu.memType or {}
  return {
    wram = mt.snesWorkRam or mt.workRam or mt.snesMemory or mt.cpuMemory,
    cpu = mt.snesCpuMemory or mt.cpuMemory or mt.snesMemory or mt.snesDebug,
    spcRam = mt.snesSpcRam or mt.spcRam or mt.spcMemory,
  }
end

local function read_byte(addr, mtype)
  if not mtype then return nil end
  local ok, v = pcall(function()
    return emu.read(addr, mtype)
  end)
  if ok then return v end
  return nil
end

local function as_num(n)
  if n == true then return 1 end
  if n == false or n == nil then return 0 end
  if type(n) == "number" then return n end
  return tonumber(n) or 0
end

local function snapshot_state()
  if not emu.getState then return end
  local ok, st = pcall(emu.getState)
  if not ok or type(st) ~= "table" then return end
  local pc16 = as_num(st["cpu.pc"] or st.pc)
  local k = as_num(st["cpu.k"])
  last_pc = ((k % 256) * 65536) + (pc16 % 65536)
  last_spc = as_num(st["spc.pc"] or st.spcPc or 0)
  last_spc_y = as_num(st["spc.y"])
  last_spc_a = as_num(st["spc.a"])
  last_spc_x = as_num(st["spc.x"])
  last_spc_sp = as_num(st["spc.sp"])
  last_cpu_a = as_num(st["cpu.a"])
  last_cpu_p = as_num(st["cpu.ps"] or st["cpu.p"])
end

local function spc_region(pc)
  pc = as_num(pc)
  if pc >= 65408 and pc < 65472 then return "copier" end
  if pc >= 902 and pc < 1024 then return "tramp" end
  if pc >= 4528 and pc < 4600 then return "nspc" end
  if pc >= 1280 and pc < 4864 then return "engine" end
  if pc >= 7936 and pc < 8192 then return "table1f" end
  if pc >= 20480 and pc < 32768 then return "seq" end
  if pc >= 65472 then return "iplrom" end
  if pc >= 32768 then return "high" end
  return "other"
end

local function read_u32(addr, mtype)
  local b0 = as_num(read_byte(addr, mtype))
  local b1 = as_num(read_byte(addr + 1, mtype))
  local b2 = as_num(read_byte(addr + 2, mtype))
  local b3 = as_num(read_byte(addr + 3, mtype))
  return b0 + b1 * 256 + b2 * 65536 + b3 * 16777216
end

local function debug_log(hid, msg)
  if not DEBUG_LOG_PATH or DEBUG_LOG_PATH == "" then return end
  local f = io.open(DEBUG_LOG_PATH, "a")
  if not f then return end
  f:write(string.format(
    '{"sessionId":"c4b0c8","hypothesisId":"%s","location":"mesen_boot_probe_nmi.lua","message":"%s","data":{"frame":%d,"cpuPc":%d,"spcPc":%d,"spcRegion":"%s","spcY":%d,"spcX":%d,"spcA":%d,"spcSp":%d,"cpuA":%d,"cpuP":%d,"destLo":%d,"destHi":%d,"wram10":%d,"wram0100":%d,"wram1dfb":%d,"wram1dff":%d,"nmitimen":%d,"apuio0":%d,"apuio1":%d,"apuio2":%d,"aram02":%d,"aram06":%d,"ch31":%d,"aram0388":%d,"aramPc":%d,"aram11b0":%d,"aram0549":%d,"f1":%d,"fa":%d,"fd":%d,"stackRet":%d,"tramp0":%d},"timestamp":%d,"runId":"post-fix-044"}\n',
    hid, msg, frame, as_num(last_pc), as_num(last_spc), spc_region(last_spc), as_num(last_spc_y), as_num(last_spc_x), as_num(last_spc_a), as_num(last_spc_sp), as_num(last_cpu_a), as_num(last_cpu_p), as_num(last_dest_lo), as_num(last_dest_hi), as_num(last_10), as_num(last_0100), as_num(last_1dfb), as_num(last_1dff), as_num(last_4200), as_num(last_2140), as_num(last_2141), as_num(last_2142), as_num(last_aram02), as_num(last_aram06), as_num(last_ch31), as_num(last_aram0388), as_num(last_aram_pc), as_num(last_aram_11b0), as_num(last_aram_0549), as_num(last_f1), as_num(last_fa), as_num(last_fd), as_num(last_stack_ret), as_num(last_tramp0), (os.time() * 1000)
  ))
  f:close()
end

local function stop_emu()
  if emu.stop then pcall(emu.stop) end
end

local function write_json(ok)
  local f = io.open(result_path, "w")
  if f then
    local okj = ok and "true" or "false"
    f:write("{\"ok\":" .. okj ..
      ",\"frame\":" .. tostring(frame) ..
      ",\"last_10\":" .. tostring(as_num(last_10)) ..
      ",\"last_0100\":" .. tostring(as_num(last_0100)) ..
      ",\"last_4200\":" .. tostring(as_num(last_4200)) ..
      ",\"last_2140\":" .. tostring(as_num(last_2140)) ..
      ",\"last_2141\":" .. tostring(as_num(last_2141)) ..
      ",\"spc_pc\":" .. tostring(as_num(last_spc)) ..
      ",\"pc\":" .. tostring(as_num(last_pc)) .. "}")
    f:close()
  end
  local d = io.open(done_path, "w")
  if d then
    d:write(ok and "ok\n" or "fail\n")
    d:close()
  end
end

local function peek_spc(spcRam)
  if not spcRam then return end
  last_aram_pc = read_u32(as_num(last_spc) % 65536, spcRam)
  last_aram_11b0 = read_u32(0x11b0, spcRam)
  last_aram_0549 = read_u32(0x0549, spcRam)
  last_f1 = as_num(read_byte(0xf1, spcRam))
  last_fa = as_num(read_byte(0xfa, spcRam))
  last_fd = as_num(read_byte(0xfd, spcRam))
  last_tramp0 = as_num(read_byte(0x0386, spcRam))
  last_aram02 = as_num(read_byte(0x0002, spcRam))
  last_aram06 = as_num(read_byte(0x0006, spcRam))
  last_aram0388 = as_num(read_byte(0x0388, spcRam))
  last_ch31 = as_num(read_byte(0x0031, spcRam)) + 256 * as_num(read_byte(0x0032, spcRam))
  local sp = as_num(last_spc_sp) % 256
  last_stack_ret = as_num(read_byte(0x100 + ((sp + 1) % 256), spcRam)) + 256 * as_num(read_byte(0x100 + ((sp + 2) % 256), spcRam))
end

local function finish(ok)
  if finished then return end
  finished = true
  snapshot_state()
  write_json(ok)
  debug_log(ok and "C" or "A", ok and "nmi-timeout-end" or "nmi-timeout")
  stop_emu()
end

local function on_frame()
  if finished then return end
  frame = frame + 1
  local mt = memtypes()
  local v = read_byte(0x0010, mt.wram)
  if v ~= nil then last_10 = as_num(v) end
  local gm = read_byte(0x0100, mt.wram)
  if gm ~= nil then last_0100 = as_num(gm) end
  local mus = read_byte(0x1dfb, mt.wram)
  if mus ~= nil then last_1dfb = as_num(mus) end
  local dff = read_byte(0x1dff, mt.wram)
  if dff ~= nil then last_1dff = as_num(dff) end
  local nmi = read_byte(0x4200, mt.cpu)
  if nmi ~= nil then last_4200 = as_num(nmi) end
  snapshot_state()
  local spcRam = mt.spcRam
  local d0 = read_byte(0x0000, spcRam)
  if d0 ~= nil then last_dest_lo = as_num(d0) end
  local d1 = read_byte(0x0001, spcRam)
  if d1 ~= nil then last_dest_hi = as_num(d1) end
  local a0 = read_byte(0x2140, mt.cpu)
  if a0 ~= nil then last_2140 = as_num(a0) end
  local a1 = read_byte(0x2141, mt.cpu)
  if a1 ~= nil then last_2141 = as_num(a1) end
  local a2 = read_byte(0x2142, mt.cpu)
  if a2 ~= nil then last_2142 = as_num(a2) end
  if frame == 1 or frame == 60 or frame == 180 then
    peek_spc(spcRam)
    debug_log("B", "frame-snapshot")
  end
  if nmi_frame == 0 and last_10 ~= 0 then
    nmi_frame = frame
    peek_spc(spcRam)
    write_json(true)
    debug_log("D", "nmi-ok")
  elseif nmi_frame > 0 then
    local d = frame - nmi_frame
    if d == 1 or d == 10 or d == 30 or d == 90 then
      peek_spc(spcRam)
      debug_log("E", "post-nmi")
    end
    if d >= 90 then
      finished = true
      stop_emu()
    end
    return
  end
  if frame >= TIMEOUT_FRAMES then
    peek_spc(spcRam)
    finish(false)
  end
end

if emu.addEventCallback and emu.eventType then
  emu.addEventCallback(on_frame, emu.eventType.startFrame or emu.eventType.endFrame or 0)
elseif emu.addEventCallback then
  emu.addEventCallback(on_frame, 0)
else
  local f = io.open(failed_path, "w")
  if f then
    f:write("no addEventCallback\n")
    f:close()
  end
  write_json(false)
  stop_emu()
end
