require 'digest/sha1'
require 'zlib'
require 'fileutils'

class PureRubyGit
  def initialize(root_dir)
    @root = File.expand_path(root_dir)
    @git_dir = File.join(@root, '.git')
  end

  def write_object(type, content)
    header = "#{type} #{content.bytesize}\0"
    store = header + content
    sha = Digest::SHA1.hexdigest(store)
    obj_dir = File.join(@git_dir, 'objects', sha[0..1])
    obj_file = File.join(obj_dir, sha[2..-1])
    unless File.exist?(obj_file)
      FileUtils.mkdir_p(obj_dir)
      File.binwrite(obj_file, Zlib::Deflate.deflate(store))
    end
    sha
  end

  def write_blob(file_path)
    content = File.binread(file_path)
    write_object('blob', content)
  end

  def build_tree(dir_path)
    entries = []
    Dir.entries(dir_path).sort.each do |item|
      next if item == '.' || item == '..' || item == '.git' || item == '.test_chrome_profile' || item == '.test_profile'
      full_path = File.join(dir_path, item)
      if File.directory?(full_path)
        sub_sha = build_tree(full_path)
        next if sub_sha.nil?
        entries << { mode: '40000', name: item, sha: sub_sha, sort_key: "#{item}/" }
      elsif File.file?(full_path)
        mode = File.executable?(full_path) ? '100755' : '100644'
        sha = write_blob(full_path)
        entries << { mode: mode, name: item, sha: sha, sort_key: item }
      end
    end

    return nil if entries.empty?

    # Git tree entries are sorted by name, but directories sort as if they have a trailing slash
    entries.sort_by! { |e| e[:sort_key] }

    tree_body = "".b
    entries.each do |e|
      tree_body << "#{e[:mode]} #{e[:name]}\0" << [e[:sha]].pack('H*')
    end

    write_object('tree', tree_body)
  end

  def init_and_commit(message:, author_name: "Joseph Sims", author_email: "josephcalvinsims@users.noreply.github.com", remote_url: "https://github.com/josephcalvinsims-prog/athletic-pt-pwa.git")
    FileUtils.mkdir_p(File.join(@git_dir, 'objects'))
    FileUtils.mkdir_p(File.join(@git_dir, 'refs', 'heads'))

    # Build root tree
    tree_sha = build_tree(@root)
    raise "Failed to build root tree" unless tree_sha

    # Check for existing parent commit
    parent_ref_file = File.join(@git_dir, 'refs', 'heads', 'main')
    parent_sha = File.exist?(parent_ref_file) ? File.read(parent_ref_file).strip : nil

    # Create Commit
    now = Time.now
    tz = now.strftime("%z")
    timestamp = "#{now.to_i} #{tz}"
    commit_lines = ["tree #{tree_sha}"]
    commit_lines << "parent #{parent_sha}" if parent_sha && !parent_sha.empty?
    commit_lines << "author #{author_name} <#{author_email}> #{timestamp}"
    commit_lines << "committer #{author_name} <#{author_email}> #{timestamp}"
    commit_lines << ""
    commit_lines << message
    commit_lines << ""
    commit_body = commit_lines.join("\n")

    commit_sha = write_object('commit', commit_body)

    # Point HEAD to refs/heads/main
    File.write(File.join(@git_dir, 'HEAD'), "ref: refs/heads/main\n")
    File.write(File.join(@git_dir, 'refs', 'heads', 'main'), "#{commit_sha}\n")

    # Config
    config_content = <<~CONF
      [core]
      \trepositoryformatversion = 0
      \tfilemode = true
      \tbare = false
      \tlogallrefupdates = true
      \tignorecase = true
      \tprecomposeunicode = true
      [remote "origin"]
      \turl = #{remote_url}
      \tfetch = +refs/heads/*:refs/remotes/origin/*
      [branch "main"]
      \tremote = origin
      \tmerge = refs/heads/main
    CONF
    File.write(File.join(@git_dir, 'config'), config_content)

    puts "[PASS] Git repository initialized successfully."
    puts "[PASS] Branch set to: main"
    puts "[PASS] Remote origin set to: #{remote_url}"
    puts "[PASS] Commit created: #{commit_sha}"
    commit_sha
  end
end

git = PureRubyGit.new('.')
commit_sha = git.init_and_commit(
  message: "Refactor Alpha Progression aesthetic, workout visual technique cards, and Web Audio breathwork engine"
)
