-- Mesen-2 in-level capture. DUMP_DIR, MODE, TIMEOUT_FRAMES injected by rhcap1-mesen.

local frame = 0
local captured = false
local done_path = DUMP_DIR .. "/done"
local wram_path = DUMP_DIR .. "/wram.bin"
local meta_path = DUMP_DIR .. "/meta.json"
local cpu_path = DUMP_DIR .. "/cpu.json"

local function memtypes()
  local mt = emu.memType or {}
  return {
    wram = mt.snesWorkRam or mt.workRam or mt.snesMemory or mt.cpuMemory,
    vram = mt.snesVideoRam or mt.videoRam,
    cgram = mt.snesCgRam or mt.cgRam,
    oam = mt.snesSpriteRam or mt.spriteRam,
    sram = mt.snesSaveRam or mt.saveRam,
    spc = mt.snesSpcRam or mt.spcRam,
    dsp = mt.snesSpcDsp or mt.spcDsp,
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

local function dump_region(path, mtype, size)
  if not mtype then return false end
  local f = io.open(path, "wb")
  if not f then return false end
  local chunk = {}
  local n = 0
  for i = 0, size - 1 do
    local b = read_byte(i, mtype)
    if b == nil then
      f:close()
      return false
    end
    n = n + 1
    chunk[n] = string.char(b % 256)
    if n >= 4096 then
      f:write(table.concat(chunk))
      chunk = {}
      n = 0
    end
  end
  if n > 0 then f:write(table.concat(chunk)) end
  f:close()
  return true
end

local function json_num(n)
  if n == nil then return "0" end
  return tostring(math.floor(n))
end

local function write_json_cpu(st)
  local f = io.open(cpu_path, "w")
  if not f then return end
  local a = st["cpu.a"] or st.a or 0
  local x = st["cpu.x"] or st.x or 0
  local y = st["cpu.y"] or st.y or 0
  local d = st["cpu.d"] or st.d or 0
  local db = st["cpu.db"] or st.db or 0
  local p = st["cpu.ps"] or st["cpu.p"] or st.p or 0
  local sp = st["cpu.sp"] or st.sp or 0
  local pc = st["cpu.pc"] or st.pc or 0
  local e = st["cpu.e"] or st.e or 1
  f:write("{\"a\":" .. json_num(a) .. ",\"x\":" .. json_num(x) .. ",\"y\":" .. json_num(y) ..
    ",\"d\":" .. json_num(d) .. ",\"db\":" .. json_num(db) .. ",\"p\":" .. json_num(p) ..
    ",\"sp\":" .. json_num(sp) .. ",\"pc\":" .. json_num(pc) .. ",\"e\":" .. json_num(e) .. "}")
  f:close()
end

local function do_capture()
  if captured then return end
  local mt = memtypes()
  if not dump_region(wram_path, mt.wram, 128 * 1024) then
    -- fallback: 128K via snesMemory $7E0000 if workRam missing
    local f = io.open(wram_path, "wb")
    if f and mt.wram == nil and emu.memType and emu.memType.snesMemory then
      local chunk = {}
      local n = 0
      for i = 0, 128 * 1024 - 1 do
        local b = read_byte(0x7E0000 + i, emu.memType.snesMemory) or 0
        n = n + 1
        chunk[n] = string.char(b % 256)
        if n >= 4096 then
          f:write(table.concat(chunk))
          chunk = {}
          n = 0
        end
      end
      if n > 0 then f:write(table.concat(chunk)) end
    end
    if f then f:close() end
  end
  dump_region(DUMP_DIR .. "/vram.bin", mt.vram, 64 * 1024)
  dump_region(DUMP_DIR .. "/cgram.bin", mt.cgram, 512)
  dump_region(DUMP_DIR .. "/oam.bin", mt.oam, 544)
  dump_region(DUMP_DIR .. "/sram.bin", mt.sram, 8 * 1024)
  dump_region(DUMP_DIR .. "/spc_aram.bin", mt.spc, 64 * 1024)
  dump_region(DUMP_DIR .. "/dsp.bin", mt.dsp, 128)

  local st = {}
  if emu.getState then
    local ok, s = pcall(emu.getState)
    if ok and type(s) == "table" then st = s end
  end
  write_json_cpu(st)

  local gm = read_byte(0x0100, mt.wram) or 0x14
  local pc = st["cpu.pc"] or 0
  local f = io.open(meta_path, "w")
  if f then
    f:write("{\"profile\":\"in_level\",\"game_mode\":" .. json_num(gm) ..
      ",\"pc\":" .. json_num(pc) .. ",\"frame\":" .. json_num(frame) .. "}")
    f:close()
  end
  local d = io.open(done_path, "w")
  if d then
    d:write("ok\n")
    d:close()
  end
  captured = true
  if emu.stop then pcall(emu.stop) end
  if emu.breakExecution then pcall(emu.breakExecution) end
end

local function in_level(mt)
  local gm = read_byte(0x0100, mt.wram)
  if gm ~= 0x14 then return false end
  local anim = read_byte(0x0071, mt.wram)
  if anim == nil then return true end
  return anim == 0
end

local function on_frame()
  if captured then return end
  frame = frame + 1
  if frame > TIMEOUT_FRAMES then
    local d = io.open(DUMP_DIR .. "/failed", "w")
    if d then
      d:write("timeout\n")
      d:close()
    end
    if emu.stop then pcall(emu.stop) end
    return
  end

  if MODE == "auto" then
    local down = (frame >= 60 and frame < 70) or (frame >= 120 and frame < 130) or (frame >= 300 and frame < 310)
    if rh_set_start then rh_set_start(down) end
  end

  local mt = memtypes()
  if in_level(mt) then
    do_capture()
  end
end

if emu.addEventCallback and emu.eventType then
  emu.addEventCallback(on_frame, emu.eventType.startFrame or emu.eventType.endFrame or 0)
elseif emu.addEventCallback then
  emu.addEventCallback(on_frame, 0)
end
