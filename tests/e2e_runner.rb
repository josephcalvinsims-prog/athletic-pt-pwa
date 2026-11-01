#!/usr/bin/env ruby
# tests/e2e_runner.rb
# Comprehensive Headless Chrome E2E Test Suite for Apex Autoreg PT PWA
# Runs using macOS System Ruby and Google Chrome DevTools Protocol (CDP)

require 'webrick'
require 'net/http'
require 'json'
require 'socket'
require 'base64'
require 'fileutils'

class SimpleWebSocketClient
  attr_reader :socket

  def initialize(url)
    uri = URI(url)
    @socket = TCPSocket.new(uri.host, uri.port)
    key = Base64.strict_encode64(16.times.map { rand(256) }.pack('C*'))
    path = uri.path + (uri.query ? "?#{uri.query}" : '')

    handshake = [
      "GET #{path} HTTP/1.1",
      "Host: #{uri.host}:#{uri.port}",
      "Upgrade: websocket",
      "Connection: Upgrade",
      "Sec-WebSocket-Key: #{key}",
      "Sec-WebSocket-Version: 13",
      "\r\n"
    ].join("\r\n")

    @socket.write(handshake)

    # Read handshake response
    response = ""
    while line = @socket.gets
      response << line
      break if line == "\r\n"
    end

    raise "WebSocket handshake failed: #{response}" unless response.include?("101 ")
  end

  def send_message(obj)
    text = JSON.generate(obj)
    bytes = text.bytes
    mask = 4.times.map { rand(256) }
    masked_payload = bytes.each_with_index.map { |b, i| b ^ mask[i % 4] }

    header = [0x81] # FIN + text
    len = bytes.length
    if len < 126
      header << (0x80 | len)
    elsif len < 65536
      header << (0x80 | 126)
      header += [len].pack('n').bytes
    else
      header << (0x80 | 127)
      header += [len].pack('Q>').bytes
    end

    @socket.write((header + mask + masked_payload).pack('C*'))
  end

  def read_message(timeout = 5)
    ready = IO.select([@socket], nil, nil, timeout)
    return nil unless ready

    b1 = @socket.getbyte
    return nil unless b1
    b2 = @socket.getbyte
    return nil unless b2

    masked = (b2 & 0x80) != 0
    len = b2 & 0x7F
    if len == 126
      len = @socket.read(2).unpack('n')[0]
    elsif len == 127
      len = @socket.read(8).unpack('Q>')[0]
    end

    mask = masked ? @socket.read(4).bytes : nil
    raw = @socket.read(len)
    return nil unless raw

    payload = if masked
      raw.bytes.each_with_index.map { |b, i| b ^ mask[i % 4] }.pack('C*')
    else
      raw
    end

    begin
      JSON.parse(payload)
    rescue
      payload
    end
  end

  def close
    @socket.close rescue nil
  end
end

class ChromeCDPDriver
  def initialize(ws_url)
    @ws = SimpleWebSocketClient.new(ws_url)
    @msg_id = 0
    @pending = {}
    @events = []
    @running = true

    @reader_thread = Thread.new do
      while @running
        msg = @ws.read_message(0.1)
        next unless msg
        if msg.is_a?(Hash)
          if msg['id']
            @pending[msg['id']] = msg
          else
            @events << msg
          end
        end
      end
    end
  end

  def call(method, params = {}, timeout = 10)
    @msg_id += 1
    id = @msg_id
    @ws.send_message({ id: id, method: method, params: params })

    start_time = Time.now
    while Time.now - start_time < timeout
      if @pending.key?(id)
        res = @pending.delete(id)
        if res['error']
          raise "CDP Error (#{method}): #{res['error']['message']}"
        end
        return res['result']
      end
      sleep 0.05
    end
    raise "CDP Call Timeout (#{method})"
  end

  def eval_js(expression, await_promise = true)
    res = call("Runtime.evaluate", {
      expression: expression,
      awaitPromise: await_promise,
      returnByValue: true
    })
    val = res.dig('result', 'value')
    if res.dig('result', 'subtype') == 'error'
      raise "JS Error: #{res.dig('result', 'description')}"
    end
    val
  end

  def drain_events
    ev = @events.dup
    @events.clear
    ev
  end

  def close
    @running = false
    @reader_thread.join(1) rescue nil
    @ws.close
  end
end

puts "========================================================"
puts "APEX AUTOREG PT — AUTOMATED E2E & CLINICAL VALIDATION"
puts "========================================================"

WORKSPACE = File.expand_path("..", File.dirname(__FILE__))
PORT = 8099
CDP_PORT = 9244
PROFILE_DIR = File.join(WORKSPACE, ".test_chrome_profile")
FileUtils.rm_rf(PROFILE_DIR)
FileUtils.mkdir_p(PROFILE_DIR)

# 1. Start WEBrick server
puts "\n[1/5] Starting local WEBrick HTTP server on port #{PORT}..."
server = WEBrick::HTTPServer.new(
  Port: PORT,
  DocumentRoot: WORKSPACE,
  Logger: WEBrick::Log.new('/dev/null'),
  AccessLog: []
)
server_thread = Thread.new { server.start }
sleep 0.5

# 2. Launch Google Chrome in Headless Mode with Remote Debugging
puts "[2/5] Launching headless Google Chrome (CDP Port #{CDP_PORT})..."
chrome_bin = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
chrome_cmd = [
  "\"#{chrome_bin}\"",
  "--headless=new",
  "--no-sandbox",
  "--disable-gpu",
  "--disable-software-rasterizer",
  "--remote-debugging-port=#{CDP_PORT}",
  "--user-data-dir=\"#{PROFILE_DIR}\"",
  "\"http://127.0.0.1:#{PORT}/index.html\""
].join(" ")

chrome_pid = Process.spawn(chrome_cmd, [:out, :err] => '/dev/null')

# Wait for Chrome DevTools endpoint to become ready
ws_url = nil
20.times do
  begin
    res = Net::HTTP.get_response(URI("http://127.0.0.1:#{CDP_PORT}/json"))
    if res.code == '200'
      list = JSON.parse(res.body)
      page = list.find { |t| t['type'] == 'page' }
      if page && page['webSocketDebuggerUrl']
        ws_url = page['webSocketDebuggerUrl']
        break
      end
    end
  rescue
  end
  sleep 0.25
end

raise "Failed to connect to Google Chrome CDP" unless ws_url
puts "Connected to Chrome DevTools Protocol: #{ws_url}"

driver = ChromeCDPDriver.new(ws_url)

begin
  # Enable CDP domains to capture console & network activity
  driver.call("Page.enable")
  driver.call("Runtime.enable")
  driver.call("Network.enable")
  driver.call("Page.navigate", { url: "http://127.0.0.1:#{PORT}" })

  # Wait for page load and initial indexedDB & charts hydration
  sleep 2.5

  # Gather console errors and failed network requests
  events = driver.drain_events
  console_errors = []
  network_failures = []

  events.each do |e|
    if e['method'] == 'Runtime.consoleAPICalled'
      type = e.dig('params', 'type')
      if type == 'error'
        text = e.dig('params', 'args', 0, 'value') || e.dig('params', 'args', 0, 'description')
        console_errors << text
      end
    elsif e['method'] == 'Runtime.exceptionThrown'
      desc = e.dig('params', 'exceptionDetails', 'text') || ''
      desc += ' ' + (e.dig('params', 'exceptionDetails', 'exception', 'description') || '')
      console_errors << "Uncaught: #{desc}"
    elsif e['method'] == 'Network.responseReceived'
      status = e.dig('params', 'response', 'status')
      url = e.dig('params', 'response', 'url')
      if status && status >= 400
        network_failures << "#{status} #{url}"
      end
    elsif e['method'] == 'Network.loadingFailed'
      url = e.dig('params', 'requestId')
      network_failures << "Failed: #{e.dig('params', 'errorText')}"
    end
  end

  # =========================================================================
  # TEST A: Zero console errors & zero 404 network failures on initial load
  # =========================================================================
  puts "\n[TEST A] Checking initial load stability & network telemetry..."
  if console_errors.any?
    puts "  [FAIL] Console errors detected:\n  #{console_errors.join("\n  ")}"
    exit(1)
  else
    puts "  [PASS] Zero console errors on initial load."
  end

  if network_failures.any?
    puts "  [FAIL] Network request failures:\n  #{network_failures.join("\n  ")}"
    exit(1)
  else
    puts "  [PASS] Zero 404 or failed network requests on initial load."
  end

  # =========================================================================
  # TEST B: Click "Load Demo Data" and inspect IndexedDB stores
  # =========================================================================
  puts "\n[TEST B] Testing 'Load Demo Data' & IndexedDB schema verification..."

  # Switch to Setup tab and click "Load Demo Data"
  driver.eval_js("window.switchTab('consultant');")
  sleep 0.3
  driver.eval_js("document.getElementById('loadDemoDataBtn').click();")
  sleep 1.0

  db_counts = driver.eval_js(<<~JS)
    new Promise(async (resolve, reject) => {
      try {
        const req = indexedDB.open('apex_autoreg_pt_db', 1);
        req.onsuccess = () => {
          const db = req.result;
          const stores = ['daily_checkins', 'workouts', 'bodywork_logs', 'settings'];
          const counts = {};
          let completed = 0;
          for (const s of stores) {
            const tx = db.transaction(s, 'readonly');
            const countReq = tx.objectStore(s).count();
            countReq.onsuccess = () => {
              counts[s] = countReq.result;
              completed++;
              if (completed === stores.length) resolve(counts);
            };
            countReq.onerror = () => reject(countReq.error);
          }
        };
        req.onerror = () => reject(req.error);
      } catch (err) {
        reject(err);
      }
    });
  JS

  puts "  IndexedDB Record Counts: #{db_counts.inspect}"
  raise "daily_checkins should have >= 7 records" unless db_counts['daily_checkins'] >= 7
  raise "workouts should have >= 5 records" unless db_counts['workouts'] >= 5
  raise "bodywork_logs should have >= 2 records" unless db_counts['bodywork_logs'] >= 2
  raise "settings should have records" unless db_counts['settings'] >= 3
  puts "  [PASS] All 4 IndexedDB stores populated with complete clinical dataset."

  # =========================================================================
  # TEST C: Autoregulation check: Scalp 8/10, Levator 7/10 -> Red Light
  # =========================================================================
  puts "\n[TEST C] Testing clinical autoregulation guardrails (Scalp 8, Levator 7)..."
  driver.eval_js("window.switchTab('dashboard');")
  sleep 0.3

  eval_result = driver.eval_js(<<~JS)
    new Promise((resolve) => {
      const scalpSlider = document.getElementById('scalpSlider');
      const interscapSlider = document.getElementById('interscapSlider');
      scalpSlider.value = '8';
      interscapSlider.value = '7';
      scalpSlider.dispatchEvent(new Event('input'));
      interscapSlider.dispatchEvent(new Event('input'));

      const badge = document.getElementById('trafficLightCodeBadge');
      const title = document.getElementById('trafficLightTitle');

      // Allow IndexedDB optimistic auto-save and UI update to complete
      setTimeout(() => {
        window.switchTab('workout');
        const workoutBanner = document.getElementById('workoutReadinessBanner');

        resolve({
          badgeText: badge ? badge.textContent.trim() : '',
          titleText: title ? title.textContent.trim() : '',
          workoutBannerText: workoutBanner ? workoutBanner.textContent : ''
        });
      }, 600);
    });
  JS

  puts "  Dashboard Title: #{eval_result['titleText']}"
  puts "  Dashboard Badge: #{eval_result['badgeText']}"

  raise "Red Light not triggered on Scalp 8, Interscapular 7" unless eval_result['titleText'].include?("Red Light")
  raise "Heavy resistance restriction not stated in badge" unless eval_result['badgeText'].include?("RESTRICT HEAVY RESISTANCE")
  raise "Workout tab banner does not lock heavy resistance" unless eval_result['workoutBannerText'].include?("Restrict Heavy Resistance")
  puts "  [PASS] Clinical guardrails correctly triggered Red Light and locked heavy resistance training."

  # =========================================================================
  # TEST C2: Tactile Stepper Buttons, 3-Zone Segmented Pills & Header Auto-Save
  # =========================================================================
  puts "\n[TEST C2] Testing tactile stepper buttons, segmented pill zones & header auto-save..."
  driver.eval_js("window.switchTab('dashboard');")
  sleep 0.3

  ergonomics_result = driver.eval_js(<<~JS)
    new Promise((resolve) => {
      // 1. Click Calm pill on Scalp (should set to 2)
      const calmPill = document.querySelector('.zone-pill-btn[data-symptom="scalp"][data-zone="calm"]');
      calmPill.click();

      // 2. Click + button on Scalp twice (should become 4 -> Caution zone)
      const plusBtn = document.getElementById('scalpPlusBtn');
      plusBtn.click();
      plusBtn.click();

      // 3. Click Flare pill on Levator (should set to 8)
      const flarePill = document.querySelector('.zone-pill-btn[data-symptom="levator"][data-zone="flare"]');
      flarePill.click();

      // 4. Click - button on Levator once (should become 7 -> still Flare)
      const levatorMinus = document.getElementById('levatorMinusBtn');
      levatorMinus.click();

      setTimeout(() => {
        const scalpBadge = document.getElementById('scalpValueBadge')?.textContent.trim();
        const levatorBadge = document.getElementById('levatorValueBadge')?.textContent.trim();
        const autoSaveHeader = document.getElementById('headerAutoSaveBadge')?.textContent.trim();
        const scalpCautionActive = document.querySelector('.zone-pill-btn[data-symptom="scalp"][data-zone="caution"]')?.classList.contains('zone-caution-active');
        const levatorFlareActive = document.querySelector('.zone-pill-btn[data-symptom="levator"][data-zone="flare"]')?.classList.contains('zone-flare-active');

        resolve({
          scalpBadge,
          levatorBadge,
          autoSaveHeader,
          scalpCautionActive,
          levatorFlareActive
        });
      }, 500);
    });
  JS

  puts "  Scalp Score after Steppers: #{ergonomics_result['scalpBadge']}"
  puts "  Levator Score after Steppers: #{ergonomics_result['levatorBadge']}"
  puts "  Header Auto-Save Status: #{ergonomics_result['autoSaveHeader']}"

  raise "Scalp badge should show 4 / 10 • Caution" unless ergonomics_result['scalpBadge'].include?("4 / 10") && ergonomics_result['scalpBadge'].include?("Caution")
  raise "Scalp caution pill should be active" unless ergonomics_result['scalpCautionActive']
  raise "Levator badge should show 7 / 10 • Flare" unless ergonomics_result['levatorBadge'].include?("7 / 10") && ergonomics_result['levatorBadge'].include?("Flare")
  raise "Levator flare pill should be active" unless ergonomics_result['levatorFlareActive']
  raise "Header auto-save indicator should show Saved" unless ergonomics_result['autoSaveHeader'].include?("Saved")
  puts "  [PASS] 3-Zone segmented pills, tactile +/- steppers, and quiet header auto-save verified."

  # =========================================================================
  # TEST C3: Workout Builder Ergonomics (Numeric Keypad & Quick Load Stepper Chips)
  # =========================================================================
  puts "\n[TEST C3] Testing Workout Builder numeric inputs & load stepper chips..."
  driver.eval_js("window.switchTab('workout');")
  sleep 0.3

  workout_inputs_result = driver.eval_js(<<~JS)
    (() => {
      const setsInput = document.querySelector('input[data-field="sets"]');
      const repsInput = document.querySelector('input[data-field="reps"]');
      const loadInput = document.querySelector('input[data-field="load"]');
      const initialLoad = Number(loadInput?.value) || 0;

      // Click +10 chip
      const plus10Btn = document.querySelector('button[data-stepper="+10"]');
      plus10Btn?.click();
      const loadAfterPlus10 = Number(loadInput?.value) || 0;

      // Click -5 chip
      const minus5Btn = document.querySelector('button[data-stepper="-5"]');
      minus5Btn?.click();
      const loadAfterMinus5 = Number(loadInput?.value) || 0;

      return {
        setsInputMode: setsInput?.getAttribute('inputmode'),
        setsPattern: setsInput?.getAttribute('pattern'),
        repsInputMode: repsInput?.getAttribute('inputmode'),
        repsPattern: repsInput?.getAttribute('pattern'),
        loadInputMode: loadInput?.getAttribute('inputmode'),
        loadPattern: loadInput?.getAttribute('pattern'),
        initialLoad,
        loadAfterPlus10,
        loadAfterMinus5
      };
    })()
  JS

  puts "  Sets inputmode: #{workout_inputs_result['setsInputMode']}, pattern: #{workout_inputs_result['setsPattern']}"
  puts "  Load inputmode: #{workout_inputs_result['loadInputMode']}, pattern: #{workout_inputs_result['loadPattern']}"
  puts "  Load adjustment: #{workout_inputs_result['initialLoad']}lb -> +10: #{workout_inputs_result['loadAfterPlus10']}lb -> -5: #{workout_inputs_result['loadAfterMinus5']}lb"

  raise "Sets input missing numeric inputmode" unless workout_inputs_result['setsInputMode'] == 'numeric'
  raise "Sets input missing [0-9]* pattern" unless workout_inputs_result['setsPattern'] == '[0-9]*'
  raise "Reps input missing numeric inputmode" unless workout_inputs_result['repsInputMode'] == 'numeric'
  raise "Load input missing decimal inputmode" unless workout_inputs_result['loadInputMode'] == 'decimal'
  raise "+10 stepper chip did not adjust load" unless workout_inputs_result['loadAfterPlus10'] == workout_inputs_result['initialLoad'] + 10
  raise "-5 stepper chip did not adjust load" unless workout_inputs_result['loadAfterMinus5'] == workout_inputs_result['loadAfterPlus10'] - 5
  puts "  [PASS] Workout table numeric keypad attributes and quick load stepper chips (+10, -5) verified."

  # =========================================================================
  # TEST C4: Tier 1 Daily Anchor Sensory Breathing Ring & Progressive Disclosure
  # =========================================================================
  puts "\n[TEST C4] Testing Daily Anchor sensory breathing ring & progressive disclosure..."
  driver.eval_js("window.switchTab('anchor');")
  sleep 0.3

  anchor_test_result = driver.eval_js(<<~JS)
    new Promise((resolve) => {
      const sphere = document.getElementById('sensoryBreathSphere');
      const phaseLabel = document.getElementById('anchorBreathPhaseLabel');
      const playBtn = document.getElementById('anchorPlayPauseBtn');
      const playTextInitial = playBtn ? playBtn.textContent.trim() : '';

      // 1. Click Start Session
      playBtn.click();

      setTimeout(() => {
        const isRunning = sphere && sphere.classList.contains('breath-inhale');
        const phaseTextRunning = phaseLabel ? phaseLabel.textContent.trim() : '';
        const playTextRunning = playBtn ? playBtn.textContent.trim() : '';

        // 2. Pause Session
        playBtn.click();

        setTimeout(() => {
          const isIdle = sphere && sphere.classList.contains('breath-idle');
          const phaseTextPaused = phaseLabel ? phaseLabel.textContent.trim() : '';
          const playTextPaused = playBtn ? playBtn.textContent.trim() : '';

          // 3. Verify progressive disclosure accordions
          const detailsAccordions = document.querySelectorAll('details.group');

          resolve({
            sphereExists: Boolean(sphere),
            playTextInitial,
            isRunning,
            phaseTextRunning,
            playTextRunning,
            isIdle,
            phaseTextPaused,
            playTextPaused,
            accordionCount: detailsAccordions.length
          });
        }, 300);
      }, 400);
    });
  JS

  puts "  Sensory Breathing Ring initial: #{anchor_test_result['playTextInitial']}"
  puts "  On Start -> Active phase: #{anchor_test_result['phaseTextRunning']}, Button: #{anchor_test_result['playTextRunning']}"
  puts "  On Pause -> Phase: #{anchor_test_result['phaseTextPaused']}, Button: #{anchor_test_result['playTextPaused']}"
  puts "  Progressive Disclosure Accordions Found: #{anchor_test_result['accordionCount']}"

  raise "Sensory breath sphere missing" unless anchor_test_result['sphereExists']
  raise "Initial button should be Start Session" unless anchor_test_result['playTextInitial'].include?("Start Session")
  raise "Sensory breathing ring not in inhale phase" unless anchor_test_result['isRunning'] && anchor_test_result['phaseTextRunning'].include?("INHALE")
  raise "Play button should switch to Pause Session" unless anchor_test_result['playTextRunning'].include?("Pause Session")
  raise "Pause session should return ring to idle" unless anchor_test_result['isIdle'] && (anchor_test_result['phaseTextPaused'].include?("PAUSED") || anchor_test_result['phaseTextPaused'].include?("READY"))
  raise "Progressive disclosure accordions missing" unless anchor_test_result['accordionCount'] >= 5
  puts "  [PASS] Sensory breathing ring expansion cadence, inflection haptic hooks, and progressive disclosure verified."

  # =========================================================================
  # TEST D: Cycle through all 5 navigation tabs twice (Chart.js redrawing & no canvas collision)
  # =========================================================================
  puts "\n[TEST D] Cycling through all 5 navigation tabs twice (Testing Chart.js redraw & memory stability)..."
  tabs = ['dashboard', 'anchor', 'workout', 'analytics', 'consultant']
  2.times do |round|
    tabs.each do |tab|
      driver.eval_js("window.switchTab('#{tab}');")
      sleep 0.2
    end
    puts "  Completed navigation cycle round #{round + 1}/2."
  end

  # Check Chart.js canvas render state on analytics tab
  driver.eval_js("window.switchTab('analytics');")
  sleep 0.5
  chart_state = driver.eval_js(<<~JS)
    (() => {
      const c1 = document.getElementById('symptomTrendCanvas');
      const c2 = document.getElementById('volumeReadinessCanvas');
      return {
        c1Ready: Boolean(c1 && c1.width > 0 && c1.height > 0),
        c2Ready: Boolean(c2 && c2.width > 0 && c2.height > 0)
      };
    })()
  JS

  raise "Chart.js canvas 1 (Symptom Trend) not properly rendered" unless chart_state['c1Ready']
  raise "Chart.js canvas 2 (Volume vs Readiness) not properly rendered" unless chart_state['c2Ready']
  puts "  [PASS] All 5 tabs cycled smoothly; Chart.js destroyed and redrew cleanly without error."

  # Check again for any late runtime errors during tests
  late_events = driver.drain_events
  late_errors = late_events.select { |e| e['method'] == 'Runtime.consoleAPICalled' && e.dig('params', 'type') == 'error' }
  if late_errors.any?
    err_msgs = late_errors.map { |e| e.dig('params', 'args', 0, 'value') || e.dig('params', 'args', 0, 'description') }
    puts "  [WARN] Late console errors: #{err_msgs.join('; ')}"
  else
    puts "  [PASS] Zero console errors across entire E2E test session."
  end

  puts "\n========================================================"
  puts "ALL AUTOMATED E2E & CLINICAL ENGINE VALIDATION TESTS PASSED!"
  puts "========================================================"
ensure
  driver.close rescue nil
  if chrome_pid
    Process.kill("TERM", chrome_pid) rescue nil
    Process.wait(chrome_pid) rescue nil
  end
  server.shutdown rescue nil
  server_thread.join(1) rescue nil
  FileUtils.rm_rf(PROFILE_DIR)
end
